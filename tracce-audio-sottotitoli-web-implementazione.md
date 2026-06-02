# Tracce Audio e Sottotitoli nel Web Player — Ricerca e Implementazione

> Analisi delle repo xtream-codes più rilevanti + piano di implementazione per Extreme-InfiniTV  
> Fonti: `jandersonss/xstream-player`, `kvnpyy/streamly`, `s074/iptv-webapp`, `hls.js` docs  
> Stack Extreme-InfiniTV: Astro + Svelte + TypeScript + Tauri + hls.js + ArtPlayer

---

## 1. Stato dell'arte nelle repo web xtream-codes

### 1.1 Panoramica delle repo esaminate

| Repo | Stack | Tracce audio HLS | Sottotitoli HLS | OpenSubtitles | Sanitize manifest | Selettore UI |
|---|---|---|---|---|---|---|
| **Extreme-InfiniTV** (nostro) | Astro + ArtPlayer + hls.js | ✅ `wireHlsForArtplayer` | ✅ hls.js embedded | ❌ | ❌ | ✅ ArtPlayer settings |
| **xstream-player** | Next.js + hls.js | ⚠️ solo nativo browser | ✅ embedded | ✅ tmdb_id match | ❌ | ⚠️ parziale |
| **streamly** | Next.js + hls.js | ✅ con codec filter | ✅ embedded | ❌ | ✅ HEVC + Dolby strip | ✅ quality selector |
| **iptv-webapp** | React + Vite | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 2. Tecnica 1 — Sanificazione manifest HLS lato server (da `streamly`)

### 2.1 Il problema

I manifest HLS IPTV spesso contengono variant stream con codec **incompatibili con i browser web**:

- **HEVC / H.265** (`hvc1`, `hev1`, `dvhe`, `dvh1`) — non decodificabile via MSE su Chrome, Firefox, Edge, Safari. Causa: il container MPEG-TS con HEVC non è supportato da MediaSource API.
- **Dolby Digital / E-AC-3** (`ac-3`, `ec-3`, `eac3`) — non decodificabile via MSE su quasi tutti i browser. Causa: il decoder software non è incluso nei browser per ragioni di licenza.

Quando hls.js riceve un master playlist con questi variant, può selezionarli e mandare in stallo il player o far partire lo stream senza audio.

### 2.2 La soluzione di `streamly`

`sanitizeTvMasterPlaylistIfNeeded()` — eseguito **server-side** nel proxy prima che il manifest raggiunga hls.js:

```typescript
// src/lib/hls-manifest-tv-sanitize.ts (streamly)

export function sanitizeTvMasterPlaylistIfNeeded(manifestBody: string): string {
  // Solo per master playlist con più variant
  if (!manifestBody.includes("#EXT-X-STREAM-INF")) return manifestBody

  const lines = manifestBody.split(/\r?\n/)
  const parts = parseMasterPlaylistLines(lines)
  if (parts.variants.length <= 1) return manifestBody

  const codecsList = parts.variants.map(v => codecsFromStreamInf(v.inf))
  let working = parts.variants

  // Rimuovi varianti HEVC se esistono alternative H.264
  const hasHevc = codecsList.some(c => c && codecsLooksHevc(c))
  const hasNonHevc = codecsList.some(c => c && !codecsLooksHevc(c))
  if (hasHevc && hasNonHevc) {
    working = working.filter((_, i) => !codecsList[i] || !codecsLooksHevc(codecsList[i]))
  }

  // Rimuovi varianti Dolby se esistono alternative AAC
  const remaningCodecs = working.map(v => codecsFromStreamInf(v.inf))
  const hasDolby = remaningCodecs.some(c => c && codecsLooksDolbyDigital(c))
  const hasNonDolby = remaningCodecs.some(c => c && !codecsLooksDolbyDigital(c))
  if (hasDolby && hasNonDolby) {
    working = working.filter((_, i) => !remaningCodecs[i] || !codecsLooksDolbyDigital(remaningCodecs[i]))
  }

  if (working.length === 0 || working.length === parts.variants.length) return manifestBody
  return rebuildMasterPlaylist({ ...parts, variants: working })
}

function codecsLooksHevc(codecs: string): boolean {
  const c = codecs.toLowerCase()
  return c.includes("hvc1") || c.includes("hev1") || c.includes("hev.")
    || c.includes("hevc") || c.includes("h265") || c.includes("dvhe") || c.includes("dvh1")
}

function codecsLooksDolbyDigital(codecs: string): boolean {
  const c = codecs.toLowerCase().replace(/\s+/g, "")
  return c.includes("ac-3") || c.includes("ac3") || c.includes("ec-3")
    || c.includes("ec3") || c.includes("eac3") || c.includes("e-ac-3")
}
```

### 2.3 Come integrarlo in Extreme-InfiniTV

#### Nel proxy Vite dev (`vite-plugin-stream-proxy.ts`)

```typescript
// In proxyHandler(), dopo aver ottenuto la risposta upstream:

if (shouldRewrite) {
  const raw = await upstream.text()
  const finalUrl = upstream.url || target

  let rewritten = looksLikeM3u8(contentType, target, raw)
    ? rewriteM3u8Playlist(raw, finalUrl)
    : raw

  // AGGIUNGERE: sanitizza varianti HEVC/Dolby incompatibili
  if (rewritten.includes("#EXT-X-STREAM-INF")) {
    rewritten = sanitizeTvMasterPlaylistIfNeeded(rewritten)
  }

  const body = Buffer.from(rewritten, "utf8")
  res.setHeader("Content-Type", contentType || "application/vnd.apple.mpegurl")
  res.setHeader("Content-Length", String(body.byteLength))
  res.end(body)
  return
}
```

#### Nel proxy Tauri (Rust, `src-tauri/`)

Aggiungere la stessa logica di parsing nel handler Rust che gestisce le richieste M3U8, oppure applicarla lato JS dopo aver ricevuto il manifest da `media_proxy_url`, prima di passarlo a hls.js:

```typescript
// In embedded-hls-tracks.ts, nel custom loader di hls.js:

hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
  // Se è un master playlist, controlla i codec
  if (data.levels && data.levels.length > 1) {
    const hasHevcOnly = data.levels.every(l =>
      l.codecs && /hvc1|hev1|dvhe/i.test(l.codecs)
    )
    if (hasHevcOnly) {
      log.warn("[xt:player] Tutti i variant sono HEVC — il browser potrebbe non supportarli")
      window.dispatchEvent(new CustomEvent("xt:hevc-only-stream"))
    }
  }
})
```

### 2.4 User-Agent per le richieste al provider

`streamly` usa UA diversi per tipo di richiesta — questa è una delle ottimizzazioni più impattanti per la compatibilità con i provider:

```typescript
// Per HLS live: molti provider Xtream rifiutano browser UA con 403
const IPTV_UA_HLS = "Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 IPTVSmartersPlayer/3.1.5"

// Per VOD: VLC garantisce 206 Partial Content (seeking funzionante)
// con UA browser alcuni provider mandano 200 con il file intero → seeking rotto
const IPTV_UA_VOD = "VLC/3.0.20 LibVLC/3.0.20"
```

In Extreme-InfiniTV, il proxy Vite usa `VLC/3.0.20 LibVLC/3.0.20` fisso per tutto. Separare l'UA per tipo di richiesta (HLS live vs VOD) migliora la compatibilità.

---

## 3. Tecnica 2 — OpenSubtitles via TMDB ID (da `xstream-player`)

### 3.1 Il vantaggio del matching per tmdb_id

Il matching per nome del contenuto è ambiguo: "The Office" trova 50 versioni diverse. Usando il `tmdb_id` (già disponibile in Extreme-InfiniTV via l'integrazione TMDB) si punta esattamente al film/episodio giusto senza ambiguità.

### 3.2 L'endpoint di `xstream-player`

`/api/subtitles` — route POST con due action:

#### Action `search`

```typescript
// app/api/subtitles/route.ts (xstream-player)

if (action === 'search') {
  const { query, languages, season_number, episode_number, year, tmdb_id, parent_tmdb_id } = params

  const searchParams = new URLSearchParams()
  if (query) searchParams.append('query', query.replace(/\s+/g, '+'))
  if (languages) searchParams.append('languages', languages.toLowerCase())  // es: "it,en"
  if (season_number) searchParams.append('season_number', String(season_number))
  if (episode_number) searchParams.append('episode_number', String(episode_number))
  if (year) searchParams.append('year', String(year))
  if (tmdb_id) searchParams.append('tmdb_id', String(tmdb_id))
  if (parent_tmdb_id) searchParams.append('parent_tmdb_id', String(parent_tmdb_id))

  searchParams.sort()  // Best practice OpenSubtitles: params alfabetici

  const url = `https://api.opensubtitles.com/api/v1/subtitles?${searchParams}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { 'Api-Key': apiKey, 'User-Agent': 'XStreamPlayer v1.0' }
  })

  // Forward rate limit info al client
  const rateLimitRemaining = response.headers.get('ratelimit-remaining')
  return NextResponse.json({ ...data, _ratelimit: { remaining: rateLimitRemaining } })
}
```

#### Action `download` — SRT → VTT server-side

```typescript
if (action === 'download') {
  // Step 1: richiedi link di download fresco (OpenSubtitles richiede link fresco ogni volta)
  const downloadResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id })
  })

  // 407 = quota giornaliera esaurita
  if (downloadResponse.status === 407) {
    return NextResponse.json({ error: 'Quota download esaurita. Riprova domani.' }, { status: 407 })
  }

  const { link, remaining } = await downloadResponse.json()

  // Step 2: scarica il file SRT
  const srtResponse = await fetch(link, { redirect: 'follow' })
  const srtContent = await srtResponse.text()

  // Step 3: converti SRT → WebVTT
  const vttContent = srtToVtt(srtContent)

  // Ritorna VTT con quota rimanente negli header
  return new Response(vttContent, {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'X-Downloads-Remaining': String(remaining ?? '')
    }
  })
}
```

#### Conversione SRT → VTT

```typescript
function srtToVtt(srt: string): string {
  let vtt = 'WEBVTT\n\n'
  vtt += srt
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Differenza chiave: SRT usa virgola, VTT usa punto nei ms
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    // Rimuovi i numeri di sequenza SRT (riga numerica prima dei timestamp)
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2})/gm, '')
  return vtt
}
```

#### Rate limiting con exponential backoff

```typescript
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { ...options, redirect: 'follow' })

    if (response.status === 429 && attempt < maxRetries) {
      const resetTime = response.headers.get('ratelimit-reset')
      // Aspetta fino al reset, o exponential backoff
      const waitMs = resetTime
        ? Math.max((parseInt(resetTime) * 1000) - Date.now(), 1000)
        : Math.pow(2, attempt + 1) * 1000  // 2s, 4s, 8s
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }

    return response
  }
  throw new Error('Max retries exceeded')
}
```

### 3.3 Come usare il VTT nel player (hls.js / ArtPlayer)

Dopo aver ottenuto il VTT dal server, iniettarlo come `<track>` o come Blob URL:

```typescript
// In embedded-hls-tracks.ts o nel componente player

async function loadExternalSubtitle(vttUrl: string, label: string, art: any) {
  // Opzione A: Blob URL (nessuna dipendenza CORS)
  const response = await fetch(vttUrl)  // /api/subtitles con action=download
  const vttText = await response.text()
  const blob = new Blob([vttText], { type: 'text/vtt' })
  const blobUrl = URL.createObjectURL(blob)

  // Aggiungere traccia ad ArtPlayer
  art.subtitleOffset = 0
  art.subtitle.switch(blobUrl, { name: label, type: 'vtt' })

  // Cleanup
  art.on('destroy', () => URL.revokeObjectURL(blobUrl))
}

// Alternativa: iniettare come <track> sull'elemento <video>
function injectTrackElement(video: HTMLVideoElement, vttUrl: string, label: string, lang: string) {
  // Rimuovi tracce esterne precedenti
  Array.from(video.textTracks).forEach(t => {
    if ((t as any)._external) t.mode = 'disabled'
  })

  const track = document.createElement('track')
  track.kind = 'subtitles'
  track.label = label
  track.srclang = lang
  track.src = vttUrl
  track.default = true
  ;(track as any)._external = true  // marker per identificarla
  video.appendChild(track)

  // Forza abilitazione (alcuni browser non la attivano automaticamente)
  video.textTracks[video.textTracks.length - 1].mode = 'showing'
}
```

### 3.4 Piano di integrazione in Extreme-InfiniTV

**Step 1**: Creare la route API (Astro server endpoint o route separata):

```
src/pages/api/subtitles.ts   (Astro API route)
```

**Step 2**: Aggiungere il selettore nell'UI del player (ArtPlayer settings):

```typescript
// In embedded-hls-tracks.ts, aggiungere dopo il selettore tracce embedded:

art.setting.add({
  name: 'xt-opensubtitles',
  html: t('player.menu.searchSubtitles') || 'Cerca sottotitoli',
  width: 280,
  mounted($panel) {
    // Input di ricerca inline nel pannello ArtPlayer
    const input = document.createElement('input')
    input.placeholder = 'Titolo o TMDB ID...'
    input.className = 'xt-sub-search-input'
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return
      const results = await searchOpenSubtitles({ query: input.value })
      renderSubtitleResults($panel, results, art)
    })
    $panel.appendChild(input)
  }
})
```

**Step 3**: Persistere la preferenza per contenuto (usare `localStorage`):

```typescript
const SUBTITLE_PREFS_KEY = 'xt:subtitle-prefs'

interface SubtitlePref {
  fileId: number
  lang: string
  label: string
}

function saveSubtitlePref(contentId: string, pref: SubtitlePref) {
  try {
    const all = JSON.parse(localStorage.getItem(SUBTITLE_PREFS_KEY) || '{}')
    all[contentId] = pref
    // Limita a 200 entry
    const keys = Object.keys(all)
    if (keys.length > 200) delete all[keys[0]]
    localStorage.setItem(SUBTITLE_PREFS_KEY, JSON.stringify(all))
  } catch {}
}

function getSubtitlePref(contentId: string): SubtitlePref | null {
  try {
    const all = JSON.parse(localStorage.getItem(SUBTITLE_PREFS_KEY) || '{}')
    return all[contentId] || null
  } catch { return null }
}

// Al mount del player VOD:
const pref = getSubtitlePref(tmdbId)
if (pref) {
  const vttUrl = await downloadSubtitle(pref.fileId)  // chiamata API
  loadExternalSubtitle(vttUrl, pref.label, art)
}
```

---

## 4. Tecnica 3 — Selettore tracce audio HLS con stato UI reattivo

### 4.1 Il gap attuale

`wireHlsForArtplayer()` aggiorna il menu ArtPlayer settings ma **non aggiorna l'indicatore visivo** nel pannello quando l'utente cambia traccia — l'item selezionato non si aggiorna in tempo reale perché ArtPlayer non ha un sistema di state binding nativo per i suoi setting.

### 4.2 Pattern corretto da implementare

```typescript
// In embedded-hls-tracks.ts — versione migliorata di refreshHlsTrackSettings()

export function refreshHlsTrackSettings(art: any, hls: any): void {
  if (!art?.setting || !hls) return

  // Rimuovi e ricrea (pattern attuale — OK ma inefficiente)
  try { art.setting.remove(SETTING_AUDIO) } catch {}
  try { art.setting.remove(SETTING_SUBTITLE) } catch {}

  const audioTracks = hls.audioTracks || []
  const currentAudio = typeof hls.audioTrack === 'number' ? hls.audioTrack : -1

  // MIGLIORAMENTO: aggiungi indicatore visivo della traccia attiva nel titolo
  const activeTrackLabel = currentAudio === -1
    ? 'Default'
    : audioTrackLabel(audioTracks[currentAudio], currentAudio)

  art.setting.add({
    name: SETTING_AUDIO,
    // Mostra la traccia attiva nel titolo del menu
    html: `${t('player.menu.audio') || 'Audio'} <span class="xt-track-hint">${activeTrackLabel}</span>`,
    width: 280,
    selector: buildAudioSelector(hls, currentAudio),
  })

  // Sottotitoli — stesso pattern
  const subtitleTracks = hls.subtitleTracks || []
  const currentSub = hls.subtitleTrack ?? -1
  const activeSubLabel = currentSub === -1 ? 'Off'
    : subtitleTrackLabel(subtitleTracks[currentSub], currentSub)

  art.setting.add({
    name: SETTING_SUBTITLE,
    html: `${t('player.menu.subtitle') || 'Sottotitoli'} <span class="xt-track-hint">${activeSubLabel}</span>`,
    width: 280,
    selector: buildSubtitleSelector(hls, currentSub, art),
  })
}

// Builder separato per testabilità
function buildAudioSelector(hls: any, currentAudio: number) {
  const tracks = hls.audioTracks || []
  return [
    {
      html: t('player.track.audioEmbedded') || 'Default',
      default: currentAudio === -1,
      onSelect() {
        hls.audioTrack = -1
        enforceMuxedHlsAudio(hls)
        ensureVideoAudible(hls.media, null)
        // Aggiorna il menu dopo la selezione
        setTimeout(() => refreshHlsTrackSettings(this.art, hls), 100)
      }
    },
    ...tracks.map((track: any, index: number) => ({
      html: audioTrackLabel(track, index),
      default: currentAudio === index,
      onSelect() {
        hls.audioTrack = index
        ensureVideoAudible(hls.media, null)
        setTimeout(() => refreshHlsTrackSettings(this.art, hls), 100)
      }
    }))
  ]
}

function buildSubtitleSelector(hls: any, currentSub: number, art: any) {
  const tracks = hls.subtitleTracks || []
  return [
    {
      html: t('player.subtitle.off') || 'Off',
      default: currentSub === -1,
      onSelect() {
        hls.subtitleTrack = -1
        hls.subtitleDisplay = false
      }
    },
    ...tracks.map((track: any, index: number) => ({
      html: subtitleTrackLabel(track, index),
      default: currentSub === index,
      onSelect() {
        hls.subtitleTrack = index
        hls.subtitleDisplay = true
      }
    })),
    // Voce per cercare sottotitoli esterni
    {
      html: `🔍 ${t('player.subtitle.searchExternal') || 'Cerca online...'}`,
      onSelect() {
        art.emit('xt:open-subtitle-search')
      }
    }
  ]
}
```

---

## 5. Tecnica 4 — Persistenza lingua audio preferita

### 5.1 Il problema

Nessuna delle repo analizzate persiste la preferenza di lingua audio tra sessioni. L'utente deve selezionare la lingua ITA ogni volta che apre un canale.

### 5.2 Implementazione

```typescript
// src/scripts/lib/audio-track-prefs.ts

const AUDIO_LANG_PREF_KEY = 'xt:preferred-audio-lang'

/** Salva la lingua preferita dall'utente (es. "ita", "it", "Italian") */
export function saveAudioLangPref(lang: string): void {
  try {
    localStorage.setItem(AUDIO_LANG_PREF_KEY, lang.toLowerCase())
  } catch {}
}

/** Legge la lingua preferita */
export function getAudioLangPref(): string | null {
  try {
    return localStorage.getItem(AUDIO_LANG_PREF_KEY)
  } catch { return null }
}

/**
 * Trova l'indice della traccia audio che corrisponde alla lingua preferita.
 * Supporta: codici ISO (it, ita), nomi (Italian, Italiano), confronto parziale.
 */
export function findPreferredAudioTrack(
  tracks: Array<{ lang?: string; name?: string; groupId?: string }>,
  preferredLang: string
): number {
  if (!tracks.length || !preferredLang) return -1
  const lang = preferredLang.toLowerCase()

  // Match esatto su lang
  let idx = tracks.findIndex(t => t.lang?.toLowerCase() === lang)
  if (idx !== -1) return idx

  // Match parziale su lang (es. "ita" dentro "ita-dub")
  idx = tracks.findIndex(t => t.lang?.toLowerCase().includes(lang) || lang.includes(t.lang?.toLowerCase() || ''))
  if (idx !== -1) return idx

  // Match su name (es. "Italian", "Italiano")
  idx = tracks.findIndex(t => t.name?.toLowerCase().includes(lang))
  if (idx !== -1) return idx

  return -1
}
```

```typescript
// In wireHlsForArtplayer(), aggiungi dopo AUDIO_TRACKS_UPDATED:

hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
  noAudioDispatched = false
  const pref = getAudioLangPref()
  if (pref && hls.audioTracks?.length > 0) {
    const preferredIdx = findPreferredAudioTrack(hls.audioTracks, pref)
    if (preferredIdx !== -1 && hls.audioTrack !== preferredIdx) {
      hls.audioTrack = preferredIdx
      log.log('[xt:player] Auto-selected preferred audio lang:', pref, 'index:', preferredIdx)
    }
  }
  syncAudio()
  refreshHlsTrackSettings(art, hls)
})

// In buildAudioSelector(), nella callback onSelect:
onSelect() {
  hls.audioTrack = index
  // Salva la preferenza per le prossime sessioni
  const lang = tracks[index]?.lang || tracks[index]?.name
  if (lang) saveAudioLangPref(lang)
  ensureVideoAudible(hls.media, null)
}
```

---

## 6. Tecnica 5 — Dimensione font sottotitoli

`xstream-player` implementa il resize font sottotitoli con shortcut `[` e `]`. In ArtPlayer questo si può fare con `art.subtitle.style`:

```typescript
// Aggiungere in wireHlsForArtplayer() o nel componente player

let subtitleFontSize = parseInt(localStorage.getItem('xt:subtitle-size') || '24')

function applySubtitleSize(art: any, size: number) {
  art.subtitle.style('font-size', `${size}px`)
  localStorage.setItem('xt:subtitle-size', String(size))
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!art.playing && !art.video) return
  if (e.key === '[') {
    subtitleFontSize = Math.max(12, subtitleFontSize - 2)
    applySubtitleSize(art, subtitleFontSize)
  } else if (e.key === ']') {
    subtitleFontSize = Math.min(48, subtitleFontSize + 2)
    applySubtitleSize(art, subtitleFontSize)
  }
})

// Applica all'avvio
applySubtitleSize(art, subtitleFontSize)
```

---

## 7. Riepilogo: file da creare/modificare

| File | Tipo | Contenuto |
|---|---|---|
| `src/scripts/lib/hls-manifest-sanitize.ts` | **NUOVO** | `sanitizeTvMasterPlaylistIfNeeded()` — strip HEVC/Dolby |
| `src/scripts/lib/audio-track-prefs.ts` | **NUOVO** | `saveAudioLangPref`, `findPreferredAudioTrack` |
| `src/pages/api/subtitles.ts` | **NUOVO** | Route POST OpenSubtitles (search + download + SRT→VTT) |
| `src/scripts/lib/embedded-hls-tracks.ts` | **MODIFICA** | Aggiunta lingua preferita auto-select + `onSelect` salva pref |
| `src/scripts/lib/embedded-hls-audio.ts` | **MODIFICA** | Aggiunta `findPreferredAudioTrack` integration |
| `src/plugins/vite-plugin-stream-proxy.ts` | **MODIFICA** | Aggiunta sanitize manifest + UA separati per HLS/VOD |

---

## 8. Priorità di implementazione

| # | Feature | Sforzo | Impatto | Da fare prima |
|---|---|---|---|---|
| 1 | **Strip HEVC/Dolby nel proxy** | 1-2h | 🔴 Risolve silenzio/freeze su TV/Chrome | — |
| 2 | **UA separati HLS vs VOD** | 30min | 🔴 Risolve 403 su molti provider | — |
| 3 | **Persistenza lingua audio** | 2-3h | 🟠 UX: no più selezione manuale ogni volta | — |
| 4 | **OpenSubtitles via tmdb_id** | 4-6h | 🟠 Sottotitoli esterni precisi per VOD | 3 |
| 5 | **Resize font sottotitoli** | 1h | 🟡 Accessibilità | 4 |
| 6 | **Indicatore traccia attiva nel menu** | 1-2h | 🟡 UX menu player | — |

---

## 9. Note su limitazioni OpenSubtitles

- **API key**: richiede registrazione su opensubtitles.com (gratuita). L'app deve permettere all'utente di inserire la propria chiave nelle impostazioni (non hardcoded come fa Megacubo).
- **Quota download**: 5 download/giorno con account free, 40 con VIP. Gestire il `407` e mostrare messaggio chiaro.
- **Cache lato client**: salvare il VTT scaricato in `localStorage` (come Blob base64) per evitare di consumare quota alla seconda visione dello stesso episodio.
- **Rate limiting**: OpenSubtitles limita a 40 req/10s per IP. Il proxy server-side aggrega tutte le richieste sotto un unico IP → rischio throttling con molti utenti. Aggiungere cache delle ricerche (TTL 1h) per query identiche.
