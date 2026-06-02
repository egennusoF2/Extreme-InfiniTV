# Sottotitoli e Tracce Audio per Device — Megacubo vs Extreme-InfiniTV

> Confronto tecnico dispositivo per dispositivo: come i due player gestiscono le tracce audio e i sottotitoli  
> Analisi basata su: `embedded-hls-tracks.ts`, `embedded-hls-audio.ts`, `embedded-native-tracks.ts`, `embedded-vod-playback.ts`, `player-runtime.ts` (Extreme-InfiniTV) e `streamer/base.js`, `subtitles/subtitles.js` (Megacubo)

---

## 1. Panoramica per piattaforma

| Piattaforma | Player usato | Sorgente tracce audio | Sorgente sottotitoli |
|---|---|---|---|
| **Desktop Windows/macOS/Linux** | ArtPlayer + hls.js / Video.js | hls.js `audioTracks` API | hls.js `subtitleTracks` + SRT→VTT server-side (Megacubo) / opensubtitles.com |
| **Android** | ArtPlayer + mpegts.js / hls.js / ExoPlayer (esterno) | hls.js `audioTracks` | hls.js `subtitleTracks` |
| **iOS / Safari** | `<video>` nativo (WKWebView) | `HTMLVideoElement.audioTracks` | `HTMLVideoElement.textTracks` |
| **TV Box (Android)** | Stessa pipeline Android ma intent esterno preferito | Dipende dal player esterno (VLC, MX Player) | Dipende dal player esterno |
| **macOS Tauri** | ArtPlayer + hls.js (non WebKit nativo) | hls.js `audioTracks` | hls.js `subtitleTracks` |

---

## 2. Desktop Windows / macOS / Linux

### 2.1 Extreme-InfiniTV

**Player predefinito**: ArtPlayer con hls.js come engine per HLS.

#### Tracce audio
Il wiring avviene in `wireHlsForArtplayer()` (`embedded-hls-tracks.ts`):

1. Su `MANIFEST_PARSED` → `syncAudio()` sceglie automaticamente la traccia migliore
2. `pickBestAudioTrackIndex()` scorre `hls.audioTracks` e preferisce codec `aac/mp4a/opus/mp3`, evita `ac3/eac3/dts`
3. Se il variant attivo non ha audio muxed (`levelCodecsHaveMuxedAudio()` → false), forza una traccia alternativa AAC
4. L'utente vede nel menu di ArtPlayer la voce **Audio** con:
   - "Default (main stream)" → `hls.audioTrack = -1` (audio muxed nel TS)
   - Una voce per ogni traccia alternativa (`EXT-X-MEDIA TYPE=AUDIO`)
   - Hint del codec corrente (es. `mp4a.40.2`)

**Logica di auto-selezione (`enforceMuxedHlsAudio`):**
```
variant ha audio muxed? → usa muxed (-1)
variant è video-only?   → prendi la prima traccia AAC disponibile
traccia attiva è AC3?   → forza ritorno a muxed o AAC
```

#### Sottotitoli
1. `hls.subtitleTracks` vengono esposti nel menu ArtPlayer su `SUBTITLE_TRACKS_UPDATED`
2. Voce **Off** sempre presente (`hls.subtitleTrack = -1`, `hls.subtitleDisplay = false`)
3. Una voce per ogni `EXT-X-MEDIA TYPE=SUBTITLES` nel manifest
4. Il rendering dei sottotitoli avviene interamente dentro hls.js (WebVTT embeddato nel manifest)
5. **Ricerca sottotitoli esterni**: non implementata in Extreme-InfiniTV (solo tracce embedded nel manifest HLS)

#### Codec non supportati
`notifyIfAudioCodecUnsupported()` controlla via `MediaSource.isTypeSupported()`:
- EC-3 / EAC-3 senza alternativa AAC → dispatcha `xt:unsupported-audio-codec`
- AC-3 senza AAC → idem
- MP2 audio senza supporto MSE → idem
- `xt:hls-no-audio-detected` se lo stream ha solo tracce incompatibili

---

### 2.2 Megacubo (Desktop Electron)

**Player**: HTML5 `<video>` nel renderer, gestito dal processo Node.js principale.

#### Tracce audio
1. Il renderer emette `audioTracks` al processo main tramite IPC bridge
2. `StreamerBase` riceve le tracce e le mostra in `showAudioTrackSelector()` come dialog testuale (non overlay sul player)
3. Selezione → `renderer.ui.emit('streamer-audio-track', n)` → renderer imposta `video.audioTracks[n].enabled = true`
4. Nessuna auto-selezione intelligente per codec: Megacubo si affida al browser per scegliere la traccia default

#### Sottotitoli
**Due modalità:**

**A) Tracce embedded HLS** (`subtitleTracks` del renderer):
- Renderer invia `subtitleTracks` al main tramite IPC
- Dialog con lista tracce + voce "Nessuno"
- `renderer.ui.emit('streamer-subtitle-track', n)` → renderer imposta `hls.subtitleTrack = n`

**B) Sottotitoli esterni da OpenSubtitles.com** (`subtitles/subtitles.js`):
- Solo desktop (escluso Android — `!paths.android && mediaType == 'video'`)
- Utente cerca per nome del contenuto → API opensubtitles.com
- Download SRT → conversione a WebVTT (`srt2vtt()`) → server HTTP locale (`http://127.0.0.1:<port>/?id=<file_id>`)
- Il VTT locale viene iniettato come `<track>` nel `<video>` renderer
- Cache locale 24h per file scaricati (evita ri-download)
- Richiede account OpenSubtitles (login + API key hardcoded)

#### Differenza chiave vs Extreme-InfiniTV
Megacubo gestisce le tracce tramite **IPC Node.js ↔ renderer**: il processo main è il "controller" e il renderer è solo un display. Extreme-InfiniTV gestisce tutto nel renderer (nessun processo main separato in produzione).

---

## 3. Android

### 3.1 Extreme-InfiniTV

**Player predefinito su Android**: Video.js (ArtPlayer viene declassato a Video.js su Android — vedi `if (backend === "artplayer" && isAndroid) backend = "videojs"`)

#### Tracce audio (HLS)
- Stessa pipeline hls.js di desktop: `wireHlsForArtplayer()` / `wireHlsAudio()`
- `enforceMuxedHlsAudio()` attiva: codec AC3/EAC3 quasi mai supportati su Android WebView → forzato sempre su AAC o muxed
- Avviso `xt:unsupported-audio-codec` se il manifest non ha AAC alternativo

#### Tracce audio (MPEG-TS diretto)
Quando si usa mpegts.js (`attachMpegts()`):
- Su `MEDIA_INFO` → `notifyIfMpegtsAudioCodecUnsupported(info.audioCodec)`
- Nessun selettore di tracce audio per MPEG-TS puro: mpegts.js non espone un'API `audioTracks` analoga a hls.js
- **Limitazione**: se lo stream TS ha più tracce audio (es. ITA + ENG), mpegts.js riproduce solo la prima

#### Sottotitoli
- Solo tracce embedded HLS (WebVTT in `EXT-X-MEDIA TYPE=SUBTITLES`)
- Nessun supporto per sottotitoli esterni su Android in Extreme-InfiniTV

#### Player esterno (VLC, MX Player, etc.)
Quando l'utente sceglie un player esterno via Android Intent:
- L'URL raw viene passato al player nativo tramite `AndroidIntent.viewStream()` o `AndroidIntent.openInVlc()`
- Tracce audio e sottotitoli gestiti interamente dal player esterno
- Extreme-InfiniTV non ha controllo su quali tracce il player esterno seleziona

---

### 3.2 Megacubo (Android via Capacitor)

#### Tracce audio
- FFmpeg sempre in modalità `copy` (no re-encoding) → le tracce audio native del TS vengono passate invariate
- ExoPlayer (WebView Android) riceve l'HLS/MPEGTS dal proxy locale e gestisce le tracce nativamente
- Megacubo su Android non espone un selettore di tracce nel menu: ExoPlayer sceglie autonomamente
- Il renderer emette `audioTracks` ma su Android Megacubo non le intercetta per mostrarle nell'UI

#### Sottotitoli
- **OpenSubtitles disabilitato** (`!paths.android` guard nel codice)
- Solo tracce embedded nel manifest HLS, gestite da ExoPlayer nativamente

---

## 4. iOS / iPadOS

### 4.1 Extreme-InfiniTV

**Player**: `<video>` nativo WKWebView (hls.js NON viene usato — `shouldUseHlsJsForM3u8()` restituisce `false` su iOS)

#### Tracce audio
- `wireNativeTracksForArtplayer()` → `refreshNativeAudioSettings()` legge `HTMLVideoElement.audioTracks`
- Su `loadedmetadata` e `loadeddata`: scan delle tracce native
- Menu ArtPlayer con selettore: abilitare/disabilitare `tracks[i].enabled`
- **Limitazione WKWebView**: `audioTracks` è spesso vuoto o read-only su iOS — il comportamento varia tra versioni iOS
- Safari/WKWebView gestisce autonomamente la traccia audio default per HLS nativo

#### Sottotitoli
- `HTMLVideoElement.textTracks` → filtra per `kind === "subtitles"` o `"captions"`
- `track.mode = "showing"` per abilitare, `"disabled"` per nascondere
- Rendering affidato completamente a WKWebView (stile nativo iOS)
- **`#EXT-X-MEDIA TYPE=SUBTITLES`**: WKWebView li gestisce nativamente se nel manifest HLS

#### URL risoluzione per iOS
`isAppleEmbedded()` è `true` → `preferVodHlsUrl()` tenta la variante `.m3u8` sibling per avere le tracce embedded, con fallback a `.mp4` se HLS non disponibile (WebKit preferisce MP4 per VOD su iOS).

---

### 4.2 Megacubo (non ha una build iOS ufficiale)

Megacubo non supporta iOS. Non analizzato.

---

## 5. TV Box (Android TV / Fire TV)

### 5.1 Extreme-InfiniTV

**Stesso stack Android** (Video.js + hls.js/mpegts.js). Le differenze principali:

- **Input**: telecomando, nessun touch → la UI del selettore tracce deve essere navigabile con D-pad
- **Player esterno**: su TV Box è comune usare `AndroidIntent` per aprire VLC o MX Player che gestiscono nativamente tutto, incluse tracce e sottotitoli
- Extreme-InfiniTV ha `listAndroidVideoPlayerApps()` per mostrare i player disponibili e `openStreamInAndroidPackage()` per lanciare quello scelto

---

### 5.2 Megacubo (TV Box)

Uguale ad Android normale. ExoPlayer gestisce tutto autonomamente.

---

## 6. macOS Tauri (specifico per Extreme-InfiniTV)

**Player**: ArtPlayer + hls.js (NON il player nativo Safari/WebKit, nonostante macOS)

Questo perché `shouldUseHlsJsForM3u8()` restituisce `true` su macOS Tauri:
```ts
// isAppleEmbedded() = true per macOS Tauri ma...
// isIosEmbedded() = false → quindi usa hls.js, non nativo
if (isIosEmbedded()) return false   // iOS: nativo
if (isTauriEmbedded()) return true  // macOS Tauri: hls.js ✓
```

Motivo: hls.js su macOS espone audio e subtitle tracks in modo affidabile. Il player nativo HLS di macOS/Safari è opaco e non permette di intercettare le tracce programmaticamente.

#### Tracce audio e sottotitoli
Identico a Desktop Windows/Linux: pipeline hls.js completa con `wireHlsForArtplayer()`.

---

## 7. VOD: recupero tracce multiple via HLS sibling

Sia per desktop che mobile, Extreme-InfiniTV tenta di preferire la versione `.m3u8` sibling di un file VOD (es. `.mkv` → `.m3u8`) perché:

- Il container `.mkv`/`.mp4` ha tracce audio/sottotitoli embedded ma il browser non può selezionarle programmaticamente in tutti i casi
- Il manifest HLS espone le stesse tracce via `EXT-X-MEDIA` e hls.js le rende selezionabili dall'utente

`preferVodHlsUrl()` (`embedded-vod-playback.ts`):
1. Costruisce URL sibling `.m3u8` (es. `/movie/user/pass/123.mkv` → `/movie/user/pass/123.m3u8`)
2. Proba i primi 2KB del manifest
3. Conta le righe `EXT-X-MEDIA` — preferisce il manifest con più `audioLines` + `subtitleLines`
4. Se nessun sibling disponibile → usa l'URL originale
5. Su Apple embedded, se HLS non disponibile → tenta il sibling `.mp4` (compatibile con WebKit)

---

## 8. Tabella riassuntiva: supporto tracce per device

| Feature | Desktop (Win/Mac/Lin) | macOS Tauri | Android | iOS WKWebView | TV Box |
|---|---|---|---|---|---|
| **Selettore tracce audio HLS** | ✅ hls.js | ✅ hls.js | ✅ hls.js | ⚠️ nativo limitato | ✅ hls.js |
| **Selettore tracce audio MPEG-TS** | ⚠️ solo con ffmpeg (Megacubo) | ❌ non esposto | ❌ mpegts.js no API | N/A | ❌ mpegts.js no API |
| **Auto-selezione codec AAC** | ✅ `enforceMuxedHlsAudio` | ✅ | ✅ | N/A (nativo) | ✅ |
| **Rilevamento AC3/EAC3 incompatibile** | ✅ `notifyIfAudioCodecUnsupported` | ✅ | ✅ | N/A | ✅ |
| **Sottotitoli HLS embedded (WebVTT)** | ✅ hls.js | ✅ hls.js | ✅ hls.js | ✅ nativo | ✅ hls.js |
| **Sottotitoli MPEG-TS embedded** | ⚠️ (Megacubo: SRT→VTT server) | ❌ | ❌ | ❌ | ❌ |
| **Sottotitoli OpenSubtitles esterni** | ✅ solo Megacubo | ❌ | ❌ | ❌ | ❌ |
| **Selezione traccia via menu player** | ✅ ArtPlayer settings | ✅ | ✅ Video.js | ✅ nativo UI | ✅ / player esterno |
| **Tracce in player esterno (VLC etc.)** | ✅ VLC/MPV gestisce | N/A | ✅ VLC/MX gestisce | N/A | ✅ |
| **HLS sibling per VOD multi-traccia** | ✅ `preferVodHlsUrl` | ✅ | ✅ | ✅ (+ mp4 fallback) | ✅ |

---

## 9. Cosa manca in Extreme-InfiniTV rispetto a Megacubo

### 9.1 Sottotitoli esterni (OpenSubtitles)
Megacubo ha un'integrazione completa con opensubtitles.com: search, download, conversione SRT→VTT, server locale, cache. Extreme-InfiniTV non ha nulla di simile — solo tracce embedded nel manifest.

**Come aggiungere**: creare un modulo `subtitle-search.ts` che:
1. Chiami l'API opensubtitles.com (REST, non richiede Node.js)
2. Scarichi il SRT e lo converta a VTT nel browser (`Blob URL`)
3. Inietti la traccia come `<track src="blob:...">` sull'elemento `<video>`
4. Aggiunga la voce al menu ArtPlayer settings

### 9.2 Selettore tracce audio per MPEG-TS
mpegts.js non espone `audioTracks` come hls.js. Se lo stream MPEG-TS ha più tracce audio, l'utente non può scegliere.

**Come aggiungere**: usare FFmpeg (via Tauri plugin) per rimuxare il TS con la traccia selezionata come unica traccia audio, oppure passare a hls.js anche per TS (re-mux lato proxy).

### 9.3 Trasformazione SRT embedded in TS
Megacubo converte i sottotitoli SRT embedded nel TS in VTT tramite il proxy Node.js (`isSRT()` + `srt2vtt()`). Extreme-InfiniTV non ha questa logica — i sottotitoli in formato SRT dentro un flusso TS non vengono mostrati.

### 9.4 Persistenza preferenza traccia audio
Né Megacubo né Extreme-InfiniTV persistono la preferenza di lingua audio tra sessioni. Megacubo ha `config.get('subtitles')` per ricordare se i sottotitoli erano attivi, ma non la lingua specifica.

**Come aggiungere in Extreme-InfiniTV**: salvare in `localStorage` la lingua audio preferita (es. `"ita"`) e applicarla automaticamente su `AUDIO_TRACKS_UPDATED` cercando la traccia con `lang` corrispondente.

---

## 10. Diagramma del flusso tracce per device (Extreme-InfiniTV)

```
URL stream
    │
    ▼
streamKindHint()
    │
    ├─ "hls" ──────────────────────────────────────────────────────────┐
    │                                                                   │
    │  iOS WKWebView?  YES → <video src> nativo                        │
    │       │ NO                └─ audioTracks: HTMLVideoElement.audioTracks
    │       │                  └─ subtitles: HTMLVideoElement.textTracks
    │       │
    │       ▼
    │  hls.js                                                           │
    │  ├─ MANIFEST_PARSED → syncAudio() → pickBestAudioTrackIndex()    │
    │  ├─ AUDIO_TRACKS_UPDATED → refreshHlsTrackSettings() → menu      │
    │  ├─ SUBTITLE_TRACKS_UPDATED → refreshHlsTrackSettings() → menu   │
    │  └─ LEVEL_SWITCHED → enforceMuxedHlsAudio()                      │
    │                                                                   │
    ├─ "ts" ──────────────────────────────────────────────────────────┤
    │  mpegts.js                                                        │
    │  ├─ MEDIA_INFO → notifyIfMpegtsAudioCodecUnsupported()           │
    │  └─ ❌ nessun selettore tracce audio                              │
    │                                                                   │
    ├─ "dash" ────────────────────────────────────────────────────────┤
    │  dash.js                                                          │
    │  └─ tracce gestite internamente da dash.js (nessun wiring custom) │
    │                                                                   │
    └─ "native" (mp4/mkv) ──────────────────────────────────────────┘
       wireNativeTracksForArtplayer()
       ├─ loadedmetadata → refreshNativeAudioSettings()
       │  └─ HTMLVideoElement.audioTracks → menu ArtPlayer
       └─ loadedmetadata → refreshNativeSubtitleSettings()
          └─ HTMLVideoElement.textTracks (kind=subtitles/captions) → menu
```
