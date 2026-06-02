# Modifiche da fare a Extreme-InfiniTV per adottare la logica Megacubo

> Basato sull'analisi di `megacubo-streaming-architecture.md`  
> Stack attuale: Astro + Svelte + TypeScript | Tauri (desktop) + Capacitor/Android  
> Obiettivo: portare in Extreme-InfiniTV i pattern di streaming di Megacubo che mancano

---

## Premessa: cosa già funziona

L'app ha già una base solida:

- Proxy dev Vite (`vite-plugin-stream-proxy.ts`) con riscrittura M3U8 → OK per dev
- `stream-proxy.ts` con proxificazione URL, fallback http/https, blind trust estensioni
- `player-runtime.ts` con selezione engine (hls.js / mpegts.js / dash.js) basata su hint dell'URL
- `probeContainer()` per sondare il content-type quando l'URL non ha estensione

**Cosa manca o è incompleto rispetto a Megacubo:**

1. Nessun **HLS Journal** (live window tracking + prefetch segmenti)
2. Nessun **Tuner** (test parallelo multi-URL con priorità)
3. Nessun **StreamState** (cache persistente online/offline per canale)
4. Il probe attuale è solo per dev — in produzione Tauri nessun probe prima del play
5. Nessun **auto-retry con fallback** su stream alternativo in caso di errore
6. Nessun rilevamento HLS live vs VOD (la distinzione `isVODM3U8` non esiste)
7. Il proxy in produzione (Tauri `media_proxy_url`) è una black box senza journal o prefetch

---

## Modifica 1 — StreamStateCache: cache persistente online/offline

### File da creare: `src/scripts/lib/stream-state-cache.ts`

Replicate il pattern `StreamState` di Megacubo, adattato al browser (localStorage).

```ts
// src/scripts/lib/stream-state-cache.ts

const STORAGE_KEY = "xt:stream-state"
const TTL_MS = 6 * 3600 * 1000        // 6 ore
const MAX_ENTRIES = 2048
const MIN_SAVE_INTERVAL_MS = 30_000

export type StreamStatus = "online" | "offline" | "unknown"

interface StreamEntry {
  status: StreamStatus
  updatedAt: number
  position?: number   // secondi, per resume VOD
  duration?: number
}

type StateMap = Record<string, StreamEntry>

let state: StateMap = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSaveAt = 0

export function loadStreamState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) state = JSON.parse(raw) as StateMap
    pruneExpired()
  } catch {}
}

export function getStreamStatus(url: string): StreamStatus | null {
  const entry = state[url]
  if (!entry) return null
  if (Date.now() - entry.updatedAt > TTL_MS) return null
  return entry.status
}

export function setStreamStatus(
  url: string,
  status: StreamStatus,
  extra?: { position?: number; duration?: number }
): void {
  const existing = state[url] || {}
  state[url] = {
    ...existing,
    status,
    updatedAt: Date.now(),
    ...extra,
  }
  scheduleSave()
}

export function getResumePosition(url: string): number | null {
  const entry = state[url]
  if (!entry || !entry.position || !entry.duration) return null
  const creditsThreshold = Math.min(180, Math.max(entry.duration * 0.05, 30))
  if (entry.position > entry.duration - creditsThreshold) return null // già visto tutto
  if (entry.position < 5) return null
  return entry.position
}

export function setResumePosition(url: string, position: number, duration: number): void {
  setStreamStatus(url, "online", { position, duration })
}

function pruneExpired(): void {
  const now = Date.now()
  const keys = Object.keys(state)
  // rimuovi scaduti
  keys.forEach(k => {
    if (now - state[k].updatedAt > TTL_MS) delete state[k]
  })
  // tronca se troppi
  const remaining = Object.keys(state)
  if (remaining.length > MAX_ENTRIES) {
    remaining
      .sort((a, b) => state[a].updatedAt - state[b].updatedAt)
      .slice(0, remaining.length - MAX_ENTRIES)
      .forEach(k => delete state[k])
  }
}

function scheduleSave(): void {
  const delay = Math.max(0, lastSaveAt + MIN_SAVE_INTERVAL_MS - Date.now())
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    pruneExpired()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      lastSaveAt = Date.now()
    } catch {}
  }, delay)
}
```

### Dove usarlo

- Chiamare `loadStreamState()` al boot dell'app (in `Layout.astro` o script principale)
- In `live-container.ts` / player: quando uno stream parte con successo → `setStreamStatus(url, "online")`
- Quando uno stream fallisce → `setStreamStatus(url, "offline")`
- Per VOD: aggiornare `setResumePosition()` ogni 10s durante la riproduzione
- Prima di avviare un canale: leggere `getStreamStatus(url)` per mostrare badge online/offline nella UI

---

## Modifica 2 — StreamProbe: probe leggero pre-play in produzione

### Problema attuale

In dev esiste `probeContainer()` in `player-runtime.ts` ma usa `providerFetch` con timeout 4s — troppo lento e non ha cache. In produzione Tauri, il probe non viene eseguito affatto.

### File da creare: `src/scripts/lib/stream-probe.ts`

```ts
// src/scripts/lib/stream-probe.ts
// Probe HTTP leggero (solo headers, niente body) per identificare tipo stream.
// Rimpiazza il probeContainer() di player-runtime.ts con caching per origine.

export type StreamKind = "hls" | "dash" | "ts" | "native" | "unknown"

// Cache per origin (stesso server = stesso tipo)
const probeCache = new Map<string, { kind: StreamKind; expiresAt: number }>()
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000  // 10 minuti

/** Hint veloce da URL/MIME senza rete — identico a streamKindHint in player-runtime.ts */
export function streamKindFromUrl(src: string, mime?: string): StreamKind | "unknown" {
  if (/\.m3u8(\?|$)/i.test(src)) return "hls"
  if (/\.mpd(\?|$)/i.test(src)) return "dash"
  if (/\.ts(\?|$)/i.test(src)) return "ts"
  if (/\.(mp4|m4v|mkv|webm|mov|avi)(\?|$)/i.test(src)) return "native"
  if (/\/live\/[^/]+\/[^/]+\/\d+(\?|#|$)/i.test(src)) return "hls"  // Xtream live
  const m = (mime || "").toLowerCase()
  if (m.includes("dash+xml")) return "dash"
  if (m.includes("mpegurl") || m.includes("m3u8")) return "hls"
  if (m === "video/mp2t" || m === "video/mpeg") return "ts"
  if (m.startsWith("video/") || m.startsWith("audio/")) return "native"
  return "unknown"
}

/** Distinzione HLS live vs VOD: analizza i primi ~2KB del manifest */
export function isVodM3u8(sample: string): boolean {
  const s = sample.toLowerCase()
  if (s.includes("#ext-x-playlist-type: vod") || s.includes("#ext-x-playlist-type:vod")) return true
  if (s.includes("#ext-x-playlist-type: event")) return true
  if (s.includes("#ext-x-endlist")) return true
  if (s.includes("#ext-x-media-sequence")) {
    const m = s.match(/#ext-x-media-sequence:\s*(\d+)/)
    if (m && parseInt(m[1]) > 1) return false  // live: sequenza alta
  }
  const segments = (s.match(/#extinf/g) || []).length
  if (segments > 30) return true  // VOD con molti segmenti
  return false
}

/**
 * Probe completo con cache per origin.
 * Timeout 4s (HEAD request) — se fallisce restituisce "hls" come default sicuro.
 */
export async function probeStreamKind(
  src: string,
  signal?: AbortSignal
): Promise<StreamKind> {
  // 1. Hint immediato da URL
  const hint = streamKindFromUrl(src)
  if (hint !== "unknown") return hint

  // 2. Cache per origine
  let origin: string
  try {
    origin = new URL(src).origin
  } catch {
    return "hls"
  }
  const cached = probeCache.get(origin)
  if (cached && Date.now() < cached.expiresAt) return cached.kind

  // 3. HEAD request leggera (solo headers)
  try {
    const controller = signal ? undefined : new AbortController()
    const fetchSignal = signal ?? controller?.signal
    const timer = controller ? setTimeout(() => controller!.abort(), 4000) : null
    try {
      const resp = await fetch(src, {
        method: "HEAD",
        headers: { Range: "bytes=0-0" },
        signal: fetchSignal,
      })
      const ct = (resp.headers.get("content-type") || "").toLowerCase()
      let kind: StreamKind = "hls"
      if (ct.includes("dash+xml") || ct.includes("mpd")) kind = "dash"
      else if (ct.includes("mpegurl") || ct.includes("m3u8")) kind = "hls"
      else if (ct.includes("mp2t") || ct.includes("mpegts")) kind = "ts"
      else if (ct.startsWith("video/") || ct.startsWith("audio/")) kind = "native"
      probeCache.set(origin, { kind, expiresAt: Date.now() + PROBE_CACHE_TTL_MS })
      return kind
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch {
    return "hls"  // default sicuro
  }
}
```

### Modifica in `player-runtime.ts`

Sostituire `probeContainer()` con l'import di `probeStreamKind`:

```ts
// Sostituire questa funzione locale:
// async function probeContainer(src: string): Promise<StreamKind> { ... }

// Con:
import { probeStreamKind } from "@/scripts/lib/stream-probe.js"
// e usare probeStreamKind(src) al posto di probeContainer(src)
```

---

## Modifica 3 — StreamTuner: test parallelo multi-URL con priorità

Quando un canale live ha più URL (da diverse sorgenti M3U), testare tutte in parallelo e scegliere la prima che risponde.

### File da creare: `src/scripts/lib/stream-tuner.ts`

```ts
// src/scripts/lib/stream-tuner.ts

import { getStreamStatus, setStreamStatus } from "./stream-state-cache.js"
import { streamKindFromUrl } from "./stream-probe.js"

export interface StreamEntry {
  url: string
  name?: string
  source?: string
}

export interface TunerResult {
  url: string
  kind: "hls" | "dash" | "ts" | "native"
  responseMs: number
}

interface TunerOptions {
  concurrency?: number         // default 2
  timeoutMs?: number           // default 5000ms per stream
  preferredUrl?: string        // URL dell'ultimo stream usato → priorità massima
  preferredFormat?: "hls" | "ts" | null
}

/**
 * Ordina le entries per priorità (logica identica ad AutoTuner.sort() di Megacubo):
 * 1. preferredUrl (ultimo guardato)
 * 2. Stream con stato "online" in cache
 * 3. Stream con formato preferito
 * 4. Stream non testati
 * 5. Stream "offline" in coda
 */
export function sortStreamEntries(
  entries: StreamEntry[],
  opts: TunerOptions = {}
): StreamEntry[] {
  const preferred: StreamEntry[] = []
  const online: StreamEntry[] = []
  const byFormat: StreamEntry[] = []
  const unknown: StreamEntry[] = []
  const offline: StreamEntry[] = []

  for (const e of entries) {
    if (e.url === opts.preferredUrl) { preferred.push(e); continue }
    const status = getStreamStatus(e.url)
    if (status === "offline") { offline.push(e); continue }
    if (status === "online") { online.push(e); continue }
    if (opts.preferredFormat) {
      const fmt = streamKindFromUrl(e.url)
      if (fmt === opts.preferredFormat) { byFormat.push(e); continue }
    }
    unknown.push(e)
  }

  return [...preferred, ...online, ...byFormat, ...unknown, ...offline]
}

/**
 * Testa le entries in parallelo (max `concurrency` per volta).
 * Restituisce il primo URL che risponde con successo.
 */
export async function findBestStream(
  entries: StreamEntry[],
  opts: TunerOptions = {}
): Promise<TunerResult | null> {
  const sorted = sortStreamEntries(entries, opts)
  const concurrency = opts.concurrency ?? 2
  const timeoutMs = opts.timeoutMs ?? 5000

  return new Promise((resolve) => {
    let resolved = false
    let pending = 0
    let index = 0

    function launchNext() {
      while (pending < concurrency && index < sorted.length) {
        const entry = sorted[index++]
        pending++
        testEntry(entry, timeoutMs).then((result) => {
          pending--
          if (result) {
            setStreamStatus(entry.url, "online")
            if (!resolved) {
              resolved = true
              resolve(result)
            }
          } else {
            setStreamStatus(entry.url, "offline")
            launchNext()
            if (pending === 0 && !resolved) resolve(null)
          }
        })
      }
    }

    launchNext()
    if (sorted.length === 0) resolve(null)
  })
}

async function testEntry(
  entry: StreamEntry,
  timeoutMs: number
): Promise<TunerResult | null> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(entry.url, {
        method: "HEAD",
        signal: controller.signal,
      })
      if (!resp.ok) return null
      const kind = streamKindFromUrl(entry.url,
        resp.headers.get("content-type") ?? undefined) as TunerResult["kind"]
      return { url: entry.url, kind: kind === "unknown" ? "hls" : kind, responseMs: Date.now() - start }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}
```

### Come usarlo in `live-container.ts`

```ts
import { findBestStream } from "@/scripts/lib/stream-tuner.js"

// Quando si ha una lista di URL per lo stesso canale:
const result = await findBestStream(channelUrls, {
  preferredUrl: lastWatchedUrl,
  preferredFormat: userPreferredFmt, // da settings
})

if (result) {
  player.src({ src: result.url, type: mimeForKind(result.kind) })
} else {
  showError("Nessuno stream disponibile per questo canale")
}
```

---

## Modifica 4 — HLS Journal nel proxy di produzione Tauri

### Problema attuale

Il proxy Tauri (`media_proxy_url` → Rust) è una black box: non ha journal dei segmenti, non fa prefetch, non gestisce la live window. Questo causa freeze quando i segmenti escono dalla finestra temporale.

### Soluzione: HLS Journal lato JS, usato da hls.js via `xhrSetup`

Implementare un **journal client-side** che tieni traccia dei segmenti recenti e corregge gli URL stantii prima che hls.js li richieda.

### File da creare: `src/scripts/lib/hls-live-journal.ts`

```ts
// src/scripts/lib/hls-live-journal.ts
// Versione semplificata dell'HLSJournal di Megacubo, adattata al browser.

const DEFAULT_LIVE_WINDOW_SECS = 120

interface SegmentEntry {
  extinf: string
  url: string
  alternateUrls: string[]
  live: boolean
  mediaSequence: number
}

export class HlsLiveJournal {
  private journal = new Map<number, SegmentEntry>()
  private currentMediaSequence = 0
  private liveWindowSecs: number

  constructor(opts?: { liveWindowSecs?: number }) {
    this.liveWindowSecs = opts?.liveWindowSecs ?? DEFAULT_LIVE_WINDOW_SECS
  }

  /** Aggiorna il journal con il contenuto di un manifest HLS appena scaricato */
  process(manifestBody: string): void {
    const lines = manifestBody.split(/\r?\n/)
    const seqMatch = manifestBody.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/i)
    const newSeq = seqMatch ? parseInt(seqMatch[1]) : 0

    // Reset se il server ha riazzerato la sequenza
    if (newSeq < this.currentMediaSequence - 10 && newSeq < 100) {
      this.journal.clear()
    }
    this.currentMediaSequence = newSeq

    let seq = newSeq
    let pendingExtinf = ""
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith("#EXTINF")) {
        pendingExtinf = t
      } else if (pendingExtinf && !t.startsWith("#")) {
        const existing = this.journal.get(seq)
        if (existing) {
          if (!existing.alternateUrls.includes(t)) existing.alternateUrls.push(t)
          existing.url = t
          existing.live = true
        } else {
          this.journal.set(seq, {
            extinf: pendingExtinf,
            url: t,
            alternateUrls: [t],
            live: true,
            mediaSequence: seq,
          })
        }
        pendingExtinf = ""
        seq++
      }
    }

    // Marca vecchi segmenti come non live
    for (const [k, v] of this.journal) {
      if (k < newSeq) v.live = false
    }

    this.trim()
  }

  /** Restituisce l'URL più aggiornato per un segmento (se ancora in live window) */
  resolveSegmentUrl(url: string): string {
    for (const entry of this.journal.values()) {
      if (entry.url === url || entry.alternateUrls.includes(url)) {
        return entry.url  // URL più recente noto
      }
    }
    return url
  }

  isInLiveWindow(url: string): boolean {
    for (const entry of this.journal.values()) {
      if (entry.live && (entry.url === url || entry.alternateUrls.includes(url))) {
        return true
      }
    }
    return false
  }

  private trim(): void {
    // Stima durata segmento dall'ultimo EXTINF
    let segDuration = 2
    for (const entry of this.journal.values()) {
      const m = entry.extinf.match(/#EXTINF:\s*([\d.]+)/)
      if (m) { segDuration = parseFloat(m[1]); break }
    }
    const maxSegments = Math.ceil(this.liveWindowSecs / segDuration)
    const keys = [...this.journal.keys()].sort((a, b) => a - b)
    while (keys.length > maxSegments) {
      this.journal.delete(keys.shift()!)
    }
  }
}
```

### Come collegarlo a hls.js (`embedded-hls-tracks.ts` o `embedded-media-fetch.ts`)

```ts
import { HlsLiveJournal } from "@/scripts/lib/hls-live-journal.js"

// Creare il journal per ogni stream live
const journal = new HlsLiveJournal()

// Nel config di hls.js, usare xhrSetup per aggiornare il journal
// e correggere gli URL dei segmenti scaduti
const hlsConfig = {
  xhrSetup(xhr: XMLHttpRequest, url: string) {
    // Se l'URL era nel journal ma scaduto, correggi silenziosamente
    const resolved = journal.resolveSegmentUrl(url)
    if (resolved !== url) {
      // hls.js non permette di cambiare URL in xhrSetup direttamente,
      // ma si può usare il loader personalizzato (vedi sotto)
    }
  },
  // Usare un loader personalizzato per aggiornare il journal sui manifest
  // e risolvere gli URL sui segmenti
}
```

> **Nota**: hls.js permette di intercettare il download dei manifest via `loader` personalizzato. Implementare un `pLoader` che chiama `journal.process(responseText)` su ogni manifest scaricato.

---

## Modifica 5 — Retry automatico con fallback su errore

### Problema attuale

Quando uno stream fallisce durante la riproduzione, l'app mostra un errore e si ferma. Megacubo invece prova automaticamente gli altri URL del canale.

### Modifica in `live-container.ts`

```ts
import { findBestStream } from "@/scripts/lib/stream-tuner.js"
import { setStreamStatus } from "@/scripts/lib/stream-state-cache.js"

// Gestione errore player:
player.on("error", async () => {
  const currentUrl = currentStreamUrl
  setStreamStatus(currentUrl, "offline")

  // Rimuovi l'URL fallito dalla lista e riprova con gli altri
  const remaining = channelUrls.filter(e => e.url !== currentUrl)
  if (remaining.length === 0) {
    showFatalError()
    return
  }

  showRetryingToast()
  const result = await findBestStream(remaining, { timeoutMs: 6000 })
  if (result) {
    currentStreamUrl = result.url
    player.src({ src: result.url, type: mimeForKind(result.kind) })
    player.play()
  } else {
    showFatalError()
  }
})
```

---

## Modifica 6 — Distinguere HLS live da VOD

### Problema attuale

`streamKindHint()` in `player-runtime.ts` restituisce sempre `"hls"` per gli `.m3u8` senza distinguere se è live o VOD. Questo è importante perché:
- Live → `liveui: true`, nessun seek, nessun resume
- VOD → seek disponibile, resume position, fallback al container MP4

### Modifica in `stream-probe.ts` (già definita sopra)

```ts
// Aggiungere alla funzione probeStreamKind():

// Per URL .m3u8, scaricare i primi 2KB per determinare live vs VOD
if (hint === "hls" && src.includes(".m3u8")) {
  try {
    const resp = await fetch(src, { headers: { Range: "bytes=0-2048" } })
    const sample = await resp.text()
    if (isVodM3u8(sample)) return "hls-vod"  // nuovo tipo
  } catch {}
}
```

### Usarlo nella selezione del player

```ts
// In live-container.ts o player entry point:
const kind = await probeStreamKind(url)
const isLive = kind !== "hls-vod" && kind !== "native"

player = await mountPlayer(videoEl, backend, {
  liveui: isLive,
  // ... altre opzioni
})
```

---

## Modifica 7 — Badge online/offline in UI (canali live)

Usare `StreamStateCache` per mostrare un indicatore visivo dello stato stream accanto a ogni canale nella lista.

### In ogni card canale (Svelte)

```svelte
<script>
  import { getStreamStatus } from "@/scripts/lib/stream-state-cache.js"
  export let channelUrl: string

  // Reattivo: aggiorna il badge quando lo stato cambia
  $: status = getStreamStatus(channelUrl) // "online" | "offline" | null
</script>

{#if status === "online"}
  <span class="badge badge-green">●</span>
{:else if status === "offline"}
  <span class="badge badge-red">●</span>
{/if}
```

---

## Modifica 8 — Prefetch segmento HLS successivo (ottimizzazione)

Riduce il buffering durante la riproduzione scaricando in anticipo il prossimo segmento.

### Integrazione con hls.js custom loader

```ts
// src/scripts/lib/hls-prefetch-loader.ts

export function createPrefetchLoader(HlsClass: any) {
  const DefaultLoader = HlsClass.DefaultConfig.loader

  return class PrefetchLoader extends DefaultLoader {
    private static lastSegmentUrl: string | null = null
    private static prefetchController: AbortController | null = null

    load(context: any, config: any, callbacks: any) {
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response: any, stats: any, context2: any, networkDetails: any) => {
          callbacks.onSuccess(response, stats, context2, networkDetails)

          // Solo per segmenti TS (non manifest)
          if (context.type === "fragment") {
            PrefetchLoader.triggerPrefetchNext(context.url, response)
          }
        },
      })
    }

    private static triggerPrefetchNext(currentUrl: string, response: any) {
      // Logica semplificata: pre-fetch del segmento con sequenza +1
      // In pratica serve accesso al manifest per sapere l'URL esatto —
      // integrare con HlsLiveJournal per ottenerlo
    }
  }
}
```

> **Nota pratica**: il prefetch completo richiede integrazione con `HlsLiveJournal` per conoscere l'URL del prossimo segmento. Implementare come secondo step, dopo aver stabilizzato il journal.

---

## Riepilogo priorità implementazione

| # | Modifica | Impatto | Complessità | Priorità |
|---|---|---|---|---|
| 1 | `StreamStateCache` (localStorage) | Badge UI + evita retry inutili | Bassa | 🔴 Alta |
| 5 | Retry automatico su errore | UX: meno freeze, più canali disponibili | Bassa | 🔴 Alta |
| 2 | `StreamProbe` migliorato + cache | Apertura canali più veloce | Media | 🟠 Media |
| 6 | Distinzione HLS live vs VOD | Comportamento corretto per VOD | Media | 🟠 Media |
| 3 | `StreamTuner` multi-URL | Zapping affidabile su canali con più sorgenti | Media | 🟠 Media |
| 7 | Badge online/offline in UI | UX qualità percepita | Bassa | 🟡 Bassa |
| 4 | HLS Journal client-side | Riduce freeze live HLS | Alta | 🟡 Bassa |
| 8 | Prefetch segmento HLS | Performance streaming live | Alta | 🟡 Bassa |

---

## Note architetturali

### Perché non serve un proxy Node.js in produzione come Megacubo

Megacubo usa un proxy Node.js locale perché gira su Electron (processo main separato). Extreme-InfiniTV usa **Tauri** con un comando Rust (`media_proxy_url`) che già gestisce CORS e header — non serve replicare l'intero proxy Node.js. Le funzionalità mancanti (journal, prefetch) si implementano lato JS nel renderer.

### Pattern da evitare

- Non replicare l'intero `StreamerFFmpeg` — Tauri ha il suo layer nativo per la transcodifica. Usare FFmpeg solo se viene aggiunto un plugin Tauri dedicato.
- Non bloccare il thread principale con il probe: usare sempre `async/await` con timeout esplicito.
- Non salvare in localStorage ad ogni aggiornamento di posizione VOD: usare debounce di 10s.
