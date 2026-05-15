---
layout: ../layouts/DocsLayout.astro
title: "Playlists (Xtream + M3U)"
description: "Add Xtream Codes credentials or paste an M3U / M3U8 URL. Multiple playlists side by side."
lede: "Two backends, one UI. Switch between accounts from the sidebar."
---

## Two ways to sign in

Extreme InfiniTV speaks two protocols. The UI does not care which one you use - both feed the same Live TV, Movies, and Series experience.

### Xtream Codes

Most paid IPTV providers expose an Xtream Codes endpoint. Enter:

- **Host** - the server URL, with `http://` or `https://`. Example: `http://example-iptv.tv`.
- **Port** - usually `80` for `http://` and `443` for `https://`. Some providers use custom ports like `8080` or `25461`.
- **Username** and **Password** - the credentials your provider gave you.

The app calls `player_api.php` on the host to fetch channels, movies, and series, and constructs stream URLs in the form `<host>:<port>/live/<user>/<pass>/<id>.m3u8`.

### M3U / M3U8 URL

Paste the full playlist URL into the **Host** field on the login screen. Leave port / username / password empty. The app detects that this is an M3U source and switches modes.

The parser handles:

- `#EXTM3U`, BOM, CRLF line endings, both `#EXTINF` orderings.
- `tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`, `catchup`.
- `#EXTGRP:` group syntax.
- `#EXTVLCOPT:http-user-agent=...` per-channel user agent (applied on Android).
- `#KODIPROP:inputstream.adaptive.*` properties.
- EPG via XMLTV from `x-tvg-url` or `tvg-url` (gzipped supported).

## Multiple playlists

You can register any number of Xtream accounts and M3U URLs side by side. Open **Settings > Playlists** to add, rename, or remove entries. Switch the active playlist from the sidebar - your favorites, watchlist, recents, and playback progress are tracked **per playlist** so accounts do not pollute each other.

A small set of views (Favorites, Watchlist, Continue watching) can show a **cross-playlist union** so you do not have to switch accounts to find a starred item.

## Categories and visibility

Some providers ship hundreds of "Adult" / "XXX" / regional categories you do not want surfaced. Open **Settings > Categories** (or the category picker on Live TV / Movies / Series) to toggle which categories are visible per playlist. Hidden categories stay hidden across restarts.

## EPG

If your Xtream provider supplies EPG data, the app reads it from `player_api.php?action=get_short_epg` and renders the now / next strip inline next to each channel. For M3U sources, the EPG comes from the XMLTV URL declared in `x-tvg-url` / `tvg-url`.

If the EPG looks shifted by a few hours, open **Settings > Live TV** and adjust the **EPG offset** for the active playlist. The full schedule grid lives at **EPG** in the sidebar.

## Backup and restore

**Settings > Backup** exports a single JSON file containing playlists, preferences, and app settings. Import it on another device to clone your setup. Credentials are included in the export, so treat the file as a secret.
