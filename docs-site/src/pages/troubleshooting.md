---
layout: ../layouts/DocsLayout.astro
title: "Troubleshooting"
description: "Test a stream, fix EPG offsets, recover from a failed login."
lede: "Most playback issues come from one of three things: the provider, the network, or the User-Agent. Here is how to narrow it down fast."
---

## Test a single stream

Right-click any channel, movie, or episode and pick **Test stream**. The diagnostic dialog reports:

- HTTP status from the stream URL.
- Content-Type returned.
- Parsed HLS manifest (if the URL is `.m3u8`) - variants, codecs, bandwidth.
- First-segment `HEAD` (if HLS) - confirms the chunks are actually reachable, not just the manifest.

If the status is `200` but playback fails, the issue is usually a codec the WebView cannot decode. Try **Open in MPV** or **Open in VLC** (desktop) or **Open in player...** (Android) - see [External players](./external-players/).

If the status is `403` or `401`, the provider is likely User-Agent-gating you. Set a custom UA under **Settings > Network** (UA presets cover the common cases: VLC, ExoPlayer, MX Player).

## "Couldn't load channels - check your login"

This is the generic Xtream login failure. Common causes:

- **Wrong protocol.** The host field must include `http://` or `https://`. Some providers ship URLs without it.
- **Wrong port.** Verify the port matches what your provider gave you - `80` and `8080` and `25461` are all common.
- **Expired account.** Some providers silently 403 expired accounts. The diagnostic dialog will surface this.
- **Geo-block.** The provider sees your IP from a region they do not serve.

The login form falls back to copy that hides the protocol layer (`Xtream-vs-M3U` is invisible by design), so if you are unsure which mode you are in, just paste the full URL into the host field. The app will detect M3U automatically and re-route.

## EPG is shifted by N hours

This is a timezone issue. EPG times are stored as absolute timestamps by XMLTV, but providers sometimes emit them in their server's local time without a `+HHMM` suffix. Open **Settings > Live TV** and set the **EPG offset** to compensate. It is persisted per playlist.

## EPG looks like base64 garbage

Some Xtream providers base64-encode `title` and `description` in `get_short_epg`. The app heuristically decodes them - if you see raw base64 anyway, file an issue with the provider's response (paste the JSON from your browser's network tab).

## Streams play but lag / buffer

- Switch to **Performance mode** under **Settings > Display**. This collapses decorative animations and blurs, gives the WebView more idle time, and helps on lower-end TVs and older Android boxes.
- On Android, the WebView's hardware video decoder is the bottleneck. Hand off to a native player (VLC, MX Player) for heavy HEVC / 4K content - see [External players](./external-players/).
- Check that your provider does not throttle concurrent connections. **Settings > Downloads** shows the cap reported by the provider's `user_info` and caps the download queue accordingly.

## Per-channel User-Agent on Android

Some providers require a specific UA per channel (M3U `#EXTVLCOPT:http-user-agent=...`). Applying that to the in-WebView fetch is impossible on the web (browsers forbid setting the UA header), but on Android the app uses a Kotlin bridge (`AndroidWebSettings.setUserAgent`) to swap the WebView UA per channel. If a stream works in VLC for Android but not in the in-app player, this is the likely cause - try **Settings > Network > Custom UA** with the value the provider expects.

## Picture-in-picture is a black rectangle (Android)

This used to happen on wry 0.55+ because `WryActivity.onPause()` pauses the WebView and Android keeps the activity paused for the entire PiP session. The fix is in `MainActivity.onPictureInPictureModeChanged(true)` - if you see a black PiP, you are running an older build. Update to the latest release.

## Downloads do not resume after a restart

Downloads auto-resume on launch via HTTP range requests. If a download is stuck:

- Check **Settings > Downloads > Folder** is set and writable (especially on Android, where SAF / MediaStore controls write access).
- Cancel and re-queue the failed item.
- If the provider sends an inconsistent `Content-Length`, the range resume can fail; restart the download from zero.

## Where settings live

| Setting | Key (web) | Stored on Tauri |
|---|---|---|
| Theme | `xt_theme` | `.xtream.creds.json` in OS app-data |
| Font scale | `xt_font_scale` | same |
| Performance mode | `xt_perf_mode` | same |
| Locale | `xt_locale` | same |
| Playlists | `xt_playlists` | same |
| Cache | IndexedDB `xt_cache` | same (WebView-owned) |

To **fully reset** the app, go to **Settings > Danger zone > Reset everything**. This clears credentials, preferences, cache, and downloads metadata, but does **not** delete the downloaded files themselves.
