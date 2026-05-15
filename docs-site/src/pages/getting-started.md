---
layout: ../layouts/DocsLayout.astro
title: "Getting started"
description: "Install Extreme InfiniTV and add your first playlist."
lede: "Install on your platform, sign in once, and start watching."
---

## Install

Pick the channel that matches your device. All builds are produced from the same source and ship the same feature set.

| Platform | Where to get it |
|---|---|
| Windows 10 / 11 | [Microsoft Store](https://apps.microsoft.com/detail/9NN162Z0WXSR) or [NSIS installer](https://github.com/infinitel8p/Extreme-InfiniTV/releases/latest) |
| Android phone / tablet / TV | [Google Play](https://play.google.com/store/apps/details?id=com.infinitel8p.xtream) or APK from [Releases](https://github.com/infinitel8p/Extreme-InfiniTV/releases/latest) |
| macOS | `.dmg` from [Releases](https://github.com/infinitel8p/Extreme-InfiniTV/releases/latest) |
| Linux | `.AppImage` or `.deb` / `.rpm` from [Releases](https://github.com/infinitel8p/Extreme-InfiniTV/releases/latest) |
| Web | Hosted fallback - works in any modern browser |

The Windows desktop build and the Linux AppImage auto-update from GitHub Releases. The Microsoft Store and Google Play handle updates themselves. Other Linux packages (deb / rpm) do not auto-update.

### Install via winget (Windows)

If you prefer the command line, install directly from the Microsoft Store source:

```powershell
winget install --id 9NN162Z0WXSR --source msstore
```

You get the same build as the Store, including automatic updates.

### macOS: "Extreme InfiniTV.app" cannot be opened

The macOS build is not yet notarized by Apple, so Gatekeeper blocks it on first launch with a message like *"Apple could not verify Extreme InfiniTV.app is free of malware"*. After dragging the app from the `.dmg` into `/Applications`, remove the quarantine flag from a Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Extreme InfiniTV.app"
```

Then open the app normally. You only need to do this once per install.

## First launch

1. Open the app. You land on the login screen.
2. Pick your sign-in method:
   - **Xtream Codes:** enter your host (with `http://` or `https://`), port, username, and password.
   - **M3U / M3U8 URL:** paste the full playlist URL into the host field. The app detects the format automatically.
3. The app validates the connection, fetches your channels, and drops you on the home screen.

Credentials are stored in your OS app-data directory on desktop and Android, and in `localStorage` on the web build. You do not need to sign in again on the next launch.

## What you see on the home screen

- **Live TV** - your channel list with category filtering and inline EPG (now / next).
- **Movies (VOD)** - poster grid with categories.
- **Series** - poster grid with seasons and episodes.
- **Continue watching** - a strip of partly-watched items that survives restarts.
- **Sidebar** (desktop) or **bottom tab bar** (phone portrait) - navigation between Live TV, Movies, Series, Favorites, Watchlist, Downloads, Search, EPG, and Settings.

## Next steps

- [Add another playlist](./playlists/) - the app supports any number of Xtream accounts and M3U URLs side by side.
- [Set up an external player](./external-players/) - if you want MPV or VLC to handle playback.
- [Learn the keyboard + D-pad bindings](./keyboard-and-d-pad/) - <kbd>Ctrl</kbd> <kbd>K</kbd> for search, <kbd>?</kbd> for the full list.
