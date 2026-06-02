# Megacubo – Architettura dei Flussi Video per Device

> Analisi tecnica della repo [EdenwareApps/Megacubo](https://github.com/EdenwareApps/Megacubo) (v17.6.x)  
> Stack: Node.js + Electron (desktop) / Capacitor + Android (mobile) | JavaScript ES Modules

---

## 1. Panoramica generale

Megacubo è un player IPTV cross-platform che supporta:

- **Windows / macOS / Linux** → Electron
- **Android / TV Box** → Capacitor + WebView nativa
- **Formati stream**: HLS (`.m3u8`), MPEG-TS (`.ts`), DASH (`.mpd`), RTMP, AAC, VOD-HLS, VOD-TS, YouTube

Il flusso video passa sempre attraverso un **layer Node.js lato processo principale**, che funge da proxy/transcoder prima di essere consegnato al renderer (HTML5 video / ExoPlayer).

---

## 2. Struttura dei moduli rilevanti

```
www/nodejs/modules/
├── streamer/
│   ├── streamer.js          # Classe principale Streamer (entry point)
│   ├── base.js              # StreamerBase + StreamerTools + StreamerTracks
│   ├── engines/
│   │   ├── base.js          # StreamerBaseIntent (classe base per tutti gli engine)
│   │   ├── hls.js           # Engine HLS live
│   │   ├── ts.js            # Engine MPEG-TS live
│   │   ├── dash.js          # Engine DASH live
│   │   ├── rtmp.js          # Engine RTMP
│   │   ├── aac.js           # Engine audio AAC
│   │   ├── video.js         # Engine video MP4/file locale
│   │   ├── vod-hls.js       # Engine HLS VOD
│   │   └── vod-ts.js        # Engine TS VOD
│   └── utils/
│       ├── stream-info.js   # Probe HTTP + rilevamento tipo stream
│       ├── proxy.js         # Proxy HTTP generico
│       ├── proxy-hls.js     # Proxy HLS con journal segmenti + prefetch
│       ├── ffmpeg.js        # Wrapper FFmpeg (transcoding/re-mux)
│       └── media-url-info.js
├── tuner/
│   ├── tuner.js             # Test parallelo di più URL stream
│   └── auto-tuner.js        # Selezione automatica del miglior stream
└── stream-state/
    └── stream-state.js      # Cache persistente dello stato degli stream
```

---

## 3. Pipeline di riproduzione: flusso step-by-step

```
URL stream (da playlist M3U)
        │
        ▼
[1] StreamState.get(url)          ← controlla cache locale (online/offline/watched)
        │
        ▼
[2] Streamer.play(entry)
        │
        ▼
[3] StreamInfo.probe(url)         ← HTTP HEAD/GET parziale (~2 KB sample)
    - rileva content-type
    - segue redirect
    - riconosce HLS master/segment, MPEG-TS, DASH, video
        │
        ▼
[4] Engine selection              ← match tra engines[] e tipo rilevato
    hls | ts | dash | rtmp | aac | video | vodhls | vodts | yt
        │
        ▼
[5] Intent.start()                ← avvia l'engine selezionato
    - crea proxy locale HTTP (127.0.0.1:<porta dinamica>)
    - oppure avvia FFmpeg
        │
        ▼
[6] Streamer.commit(intent)       ← passa endpoint al renderer
        │
        ▼
[7] HTML5 <video> / ExoPlayer     ← riproduce dall'endpoint locale
```

---

## 4. Rilevamento del tipo di stream (`stream-info.js`)

### 4.1 Probe HTTP
`StreamInfo._probe()` esegue una richiesta HTTP con timeout configurabile (`connect-timeout * 2`). Raccoglie fino a **2048 byte** di sample per identificare il formato:

| Segnale rilevato | Tipo assegnato |
|---|---|
| `#EXTM3U` / `#EXTINF` nel sample | HLS |
| `#EXT-X-STREAM-INF` (master playlist) | HLS → ricorsione sul variant stream |
| Sample binario + URL con `.ts` | MPEG-TS |
| `content-type: application/dash+xml` o ext `.mpd` | DASH |
| `content-type: video/mp4` o binario video | Video/MP4 |
| Protocollo RTMP | RTMP |

### 4.2 Blind Trust (ottimizzazione velocità)
Se l'opzione `tuning-blind-trust` è attiva, per URL con estensione nota (`.ts`, `.m3u8`, `.mpd`) il probe viene **saltato** e il tipo dedotto direttamente dall'URL. Eccezione: `.m3u8` richiede sempre verifica (serve per distinguere live da VOD).

### 4.3 Distinzione HLS live vs VOD
`StreamerBaseIntent.isVODM3U8()` analizza il sample per capire se è un HLS VOD:
- Presenza di `#EXT-X-PLAYLIST-TYPE: VOD` o `EVENT`
- `#EXT-X-MEDIA-SEQUENCE` con valore alto → live
- `#EXT-X-ENDLIST` presente → VOD
- Più di 30 segmenti `#EXTINF` → VOD

---

## 5. Engine per tipo di stream

### 5.1 HLS Live (`engines/hls.js`)

**Classe**: `StreamerHLSIntent`

Flusso:
1. Crea `StreamerHLSProxy` (proxy HTTP locale)
2. Se `ffmpeg-broadcast-pre-processing = yes`: seleziona il variant stream ottimale per bandwidth e lo passa a `StreamerFFmpeg`
3. Altrimenti: espone direttamente il proxy HLS al renderer

**HLS Track Selection** (`HLSTrackSelector`):
- Scarica la master playlist e ne parse le varianti (bandwidth + risoluzione)
- Seleziona il variant più adatto alla connessione attuale (`streamer.downlink`)
- Se bandwidth non noto, sceglie la seconda variante (salta possibili tracce audio-only)

**Trascodifica on-demand** (`transcode()`):
- Triggered quando il renderer non riesce a riprodurre (type mismatch)
- Switcha a FFmpeg per re-muxare/transcodificare

---

### 5.2 MPEG-TS Live (`engines/ts.js`)

**Classe**: `StreamerTSIntent`

Flusso:
1. Crea `StreamerAdapterTS` (downloader specializzato per TS)
2. Se `ffmpeg-broadcast-pre-processing = yes` o `= mpegts`: passa il flusso a FFmpeg
3. Altrimenti: serve il raw TS stream al renderer via endpoint locale

Su **Android**: FFmpeg sempre in modalità `copy` (no transcoding) per preservare le performance.

---

### 5.3 DASH Live (`engines/dash.js`)

**Classe**: `StreamerDashIntent`

Flusso:
1. Crea `StreamerProxy` generico
2. Proxifica i manifest MPD e i segmenti
3. `mimetype = application/dash+xml`
4. Il renderer usa **dash.js** (v5.x) per il parsing e la riproduzione

---

### 5.4 RTMP (`engines/rtmp.js`)

Usa FFmpeg per convertire RTMP → HLS/MPEGTS locale. Non supportato su Android (FFmpeg RTMP non compilato per mobile).

---

### 5.5 VOD HLS / VOD TS

Simili ai corrispettivi live ma con gestione diversa del buffer e senza la logica del live window. Supportano **resume della posizione** (salvata in `stream-state`).

---

## 6. Il proxy HLS (`utils/proxy-hls.js`)

È il componente più complesso. Crea un **server HTTP locale** che:

### 6.1 Proxificazione URL
Tutti gli URL di segmenti e manifest vengono riscritti per passare attraverso `127.0.0.1:<porta>`:
- `http://server/...` → `http://127.0.0.1:<port>/server/...`
- `https://server/...` → `http://127.0.0.1:<port>/s/server/...`

Questo permette di gestire CORS, autenticazione, retry e caching in modo trasparente al renderer.

### 6.2 HLS Journal
`HLSJournal` tiene traccia della **live window** (finestra temporale di segmenti validi):

- Mappa ogni segmento con il suo `EXT-X-MEDIA-SEQUENCE`
- Mantiene lo storico per `live-window-time` secondi (default: 120s)
- Rileva reset del media sequence (restart del server) e ripulisce il journal
- Se un segmento esce dalla live window → serve dalla cache o restituisce 204

### 6.3 Prefetching
Dopo ogni segmento scaricato, tenta di pre-scaricare il **segmento successivo** in background (`shadowClient = true`) per ridurre buffering:
- Non avvia prefetch se c'è già un download utente in corso
- Rispetta la live window (non prefetch segmenti scaduti)
- Gli errori di prefetch non impattano la riproduzione

### 6.4 Fallback tra variant stream
Se un variant HLS risponde 404, il proxy tenta automaticamente gli altri variant della master playlist prima di dichiarare il canale offline.

### 6.5 Bitrate detection e static stream detection
Il proxy raccoglie campioni di segmenti per:
- Calcolare il bitrate effettivo
- Rilevare stream "statici" (immagine fissa) tramite analisi frame-by-frame

---

## 7. FFmpeg wrapper (`utils/ffmpeg.js`)

`StreamerFFmpeg` è un wrapper asincrono attorno al binario FFmpeg che:

### Output format
- **HLS** (default): crea `master.m3u8` + segmenti `.ts` in directory temporanea, poi li serve via HTTP locale
- **MPEGTS**: FFmpeg apre un server HTTP interno (`-listen 1`) e un Downloader wrapper aggiuntivo per compatibilità con ExoPlayer (che può fare solo una connessione per volta)

### Codecs
- Default: `videoCodec = copy`, `audioCodec = copy` (no transcoding)
- Auto-transcoding attivato se il codec rilevato è `mpeg2video`, `mpeg4`, `ac3`, `mp2` (non supportati dal renderer)
- Su Android: sempre `copy` per entrambi

### Opzioni FFmpeg chiave
```
-fflags +igndts              # ignora timestamp discontinui
-reconnect 1                 # riconnessione automatica
-reconnect_at_eof 1
-reconnect_streamed 1
-stream_loop -1              # loop infinito (live)
-hls_flags delete_segments+omit_endlist  # live HLS
-hls_time 2                  # segmenti da 2s
```

### Restart automatico
Se FFmpeg termina inaspettatamente su uno stream live e l'intent è committed (il player stava riproducendo), si avvia automaticamente con `append_list` per continuare dal punto corretto.

---

## 8. Tuner: selezione automatica dello stream (`tuner/`)

Quando un canale ha più URL disponibili (da più liste M3U), il **Tuner** le testa in parallelo e sceglie la migliore.

### 8.1 `Tuner` (tuner.js)
- Testa N URL in parallelo (`tune-concurrency` configurabile)
- Per ogni URL chiama `streamer.info()` (probe)
- Rispetta il rate limiting per dominio (max 1 req/sec per stesso dominio)
- Emette `success` per ogni URL funzionante, `failure` per quelli offline
- Alla fine emette i risultati ordinati per velocità

### 8.2 `AutoTuner` (auto-tuner.js)
Estende Tuner con logica di **ordinamento prioritizzato**:

**Ordine di priorità degli stream**:
1. URL dell'ultimo stream guardato (`preferredStreamURL`)
2. Stream da server già noti (history recente)
3. Stream con stato `online` in cache
4. Stream con formato preferito (HLS o MPEG-TS da impostazioni)
5. Stream non testati
6. Stream con stato `offline` (ritestati per ultimi)

**Concorrenza FFmpeg**: gli engine che richiedono FFmpeg (`ts`, `rtmp`, `dash`, `aac`) hanno un limite separato (`tune-ffmpeg-concurrency`) per evitare di saturare la CPU.

---

## 9. Stream State Cache (`stream-state/stream-state.js`)

Sistema di **cache persistente** dello stato degli stream su disco (`storage`):

- TTL: **6 ore** per ogni entry
- Limite: **4096 entry** (FIFO per timestamp)
- Salvataggio differito con intervallo minimo di **30 secondi**

### Stati possibili
| Stato | Significato |
|---|---|
| `tune` | Stream live funzionante |
| `folder` | È una cartella/playlist (non stream diretto) |
| `offline` | Stream non raggiungibile |
| `waiting` | In fase di test |

### Informazioni aggiuntive salvate
- `position` e `duration`: per il **resume** di contenuti VOD
- Soglia "watched": se `position > duration - max(30s, 5%)` il contenuto è considerato visto

### Auto-test
Quando il menu mostra una lista di canali, se `auto-test` è attivo, i canali non testati vengono testati in background tramite `Tuner` in modalità `shadow` (senza aprire il player).

---

## 10. Differenze per piattaforma

| Aspetto | Desktop (Electron) | Android (Capacitor) |
|---|---|---|
| Build system | Electron Builder | Capacitor + Gradle |
| Player renderer | HTML5 `<video>` + hls.js/mpegts.js/dash.js | WebView + ExoPlayer (via plugin nativo) |
| FFmpeg | Binario nativo x64/arm64 | `tv.megacubo.ffmpeg` (AAR nativo) |
| Audio codec default | AAC (FFmpeg) | copy (no transcoding) |
| RTMP | Supportato via FFmpeg | Non supportato |
| Sottotitoli | hls.js + opensubtitles.com | Solo tracce embedded |
| Proxy HLS | `127.0.0.1` locale | `127.0.0.1` locale (stessa logica) |
| Output FFmpeg | HLS o MPEGTS | MPEGTS (ExoPlayer lo preferisce) |
| Percorsi temp | `os.tmpdir()` | Directory interna app Android |

### Nota Android/ExoPlayer
ExoPlayer può aprire **una sola connessione per volta** verso FFmpeg. Per questo `StreamerFFmpeg` in modalità `mpegts` aggiunge un ulteriore `Downloader` wrapper che funge da buffer intermedio (`warmCache: true`), così ExoPlayer può connettersi al wrapper mentre FFmpeg lavora indipendentemente.

---

## 11. Configurazioni chiave

| Chiave config | Descrizione | Default |
|---|---|---|
| `ffmpeg-broadcast-pre-processing` | `no`/`yes`/`mpegts` – quando usare FFmpeg per pre-processare | `no` |
| `tune-concurrency` | Parallelismo test stream nel Tuner | 2 |
| `tune-ffmpeg-concurrency` | Parallelismo test stream FFmpeg-based | 1 |
| `auto-test` | Test automatico stream in background | `true` |
| `live-stream-fmt` | Formato preferito: `hls` o `mpegts` | nessuno |
| `live-window-time` | Durata live window HLS in secondi | 120 |
| `hls-prefetching` | Prefetch segmento HLS successivo | `true` |
| `broadcast-start-timeout` | Timeout avvio stream in secondi (min 20) | 20 |
| `connect-timeout` | Timeout connessione HTTP | 10 |
| `tuning-blind-trust` | Tipi stream da accettare senza probe | `` |
| `transcoding` | Abilita transcoding video (libx264) | `true` |
| `preferred-livestream-fmt` | Output FFmpeg: `hls` o `mpegts` | `hls` |

---

## 12. Gestione errori e fallback

### Errori HTTP mappati
| Codice HTTP | Messaggio utente |
|---|---|
| 400/401/403 | "Stream protetto" |
| 404/406/410 | "Stream offline" |
| 421/500/502/503/504 | "Server sovraccarico" |
| 422 | "Nessuna connessione internet" |
| 458 | "Contenuto bloccato / verifica abbonamento" |
| timeout | "Server lento" |

### Logica di fallback
1. Errore su stream attivo → `handleFailure()`
2. Se il canale ha altri URL disponibili nel Tuner → `tune()` (prova il prossimo)
3. Se nessun URL funziona → dialog utente: "Prova alternativo / Riprova / No"
4. `StreamState` marca l'URL come `offline` (TTL 6h)

---

## 13. Diagramma architetturale semplificato

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer (WebView)                    │
│  hls.js / mpegts.js / dash.js / HTML5 <video>          │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP  127.0.0.1:<porta>
┌────────────────────▼────────────────────────────────────┐
│              Node.js Process (Main)                      │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Tuner   │  │StreamState│  │   Streamer           │  │
│  │(test URL)│  │ (cache)   │  │ ┌──────────────────┐ │  │
│  └──────────┘  └───────────┘  │ │ StreamInfo.probe │ │  │
│                               │ └────────┬─────────┘ │  │
│                               │          │            │  │
│                               │ ┌────────▼─────────┐ │  │
│                               │ │  Engine Intent   │ │  │
│                               │ │ hls/ts/dash/rtmp │ │  │
│                               │ └────────┬─────────┘ │  │
│                               │          │            │  │
│                               │ ┌────────▼─────────┐ │  │
│                               │ │  HLS Proxy  /    │ │  │
│                               │ │  FFmpeg wrapper  │ │  │
│                               │ └──────────────────┘ │  │
│                               └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                     │ HTTP/RTMP
┌────────────────────▼────────────────────────────────────┐
│               Server IPTV esterno                        │
│  (HLS stream / MPEG-TS / DASH / RTMP / Xtream Codes)   │
└─────────────────────────────────────────────────────────┘
```

---

## 14. Come replicare pattern simili in Extreme-InfiniTV

Le tecniche chiave di Megacubo applicabili a un progetto IPTV:

1. **Proxy locale obbligatorio**: non passare mai URL esterni direttamente al player. Il proxy intermedio permette retry, autenticazione, riscrittura header e fallback su variant stream.

2. **Probe leggero prima del play**: 2 KB di sample sono sufficienti per identificare il tipo di stream senza sprecare banda.

3. **HLS Journal**: tenere memoria dei segmenti recenti permette di gestire i gap della live window e i prefetch senza rompersi su stream con media sequence non monotona.

4. **Tuner con priorità**: ordinare gli URL per stato storico (online/offline/preferito) prima di testarli riduce drasticamente il tempo di zapping.

5. **Blind trust per URL tipizzati**: se l'URL contiene estensione nota e ci si fida del server, saltare il probe velocizza l'apertura del canale.

6. **Separazione engine/adapter**: ogni formato stream ha il suo engine, ma condividono l'infrastruttura proxy. Aggiungere un nuovo formato richiede solo un nuovo engine con metodo `supports()` e `_start()`.
