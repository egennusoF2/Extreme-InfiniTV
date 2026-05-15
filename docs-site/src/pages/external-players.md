---
layout: ../layouts/DocsLayout.astro
title: "External players"
description: "Hand off playback to MPV, VLC, or any installed Android video app."
lede: "When the built-in player isn't enough, route a stream to MPV or VLC. Desktop and Android both supported."
---

The in-app player is Video.js with `hls.js` and is good enough for most streams. For codecs the WebView cannot decode, or when you want a specific player's controls / EQ / subtitle handling, hand the stream off to an external player.

## Desktop (Windows / macOS / Linux)

Configure once under **Settings > External players**:

- **MPV** - point at the `mpv` executable. The app reuses a single MPV instance via JSON IPC (Unix socket on macOS / Linux, named pipe `\\.\pipe\xt-mpv-N` on Windows), so re-tuning a channel sends a `loadfile` to the existing window instead of spawning a new one.
- **VLC** - point at the `vlc` executable. The app passes `--one-instance --no-playlist-enqueue` so re-tuning replaces the playing item in the existing window.

Once a path is set, an **"Open in MPV"** or **"Open in VLC"** button appears on movies, series episodes, and the Live TV row. On Live TV the same logic is inlined into the **#current** row, which is rebuilt on every channel switch.

> If MPV or VLC was quit manually, the reuse slot is dropped on the next IPC failure and the next handoff starts a fresh instance transparently. You do not need to clear any cache.

Error prefixes in the toast tell you which step failed:

- `NOT_FOUND:` the executable does not exist at the path you configured.
- `PERMISSION:` the OS refused to execute it.
- `TIMEOUT:` the player did not respond on the IPC channel.
- `OTHER:` everything else (full message in the toast).

## Android

The Android build hands off to any installed video app via `Intent.ACTION_VIEW`. No extra setup - if the app is installed, it shows up.

- **"Open in VLC"** appears when [VLC for Android](https://play.google.com/store/apps/details?id=org.videolan.vlc) is installed. The intent is pinned to `org.videolan.vlc` and includes both MX-Player-style headers (`headers` String[]) and VLC-style extras (`:http-user-agent`, `:http-referrer`), so per-channel User-Agents flow through.
- **"Open in player..."** opens the system chooser so you can pick MX Player, [Just Player](https://play.google.com/store/apps/details?id=com.brouken.player), Plex, or anything else that handles `video/*` or HLS.

The MIME type is picked from the URL:

| URL ends with | MIME |
|---|---|
| `.m3u8` | `application/vnd.apple.mpegurl` |
| `.ts` | `video/mp2t` |
| `.mp4`, `.mkv`, `.webm`, `.avi` | the matching container MIME |
| anything else (opaque Xtream URLs) | `video/*` |

If the target app respects the headers extras you pass, per-channel User-Agents work even outside the in-app player.

## Local files (downloaded content)

The **Downloads** page lets you queue movies and series episodes for offline playback. When you press play on a completed download:

- **Desktop:** the in-app player loads the local file via the Tauri `asset.localhost` protocol. No external player needed.
- **Android:** the app tries `Intent.ACTION_VIEW` on the local file URI before falling back to in-app playback, because in-WebView local playback is currently broken on Android in Tauri 2 (upstream bug).

You can still hand off remote streams to any of the configured external players from the detail dialog.

## When to use which

- **In-app player** for live TV channel-flipping, casual VOD watching, EPG-driven viewing.
- **MPV** for power-user playback, hardware decoding, lossless aspect ratio fitting, scripting.
- **VLC** for stubborn streams, codec coverage, network diagnostics.
- **Android chooser** when you already have a preferred Android video app and want to keep using it.
