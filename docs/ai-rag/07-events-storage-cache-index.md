# Events, storage, and cache index

## DOM event index

### Playlist and catalog events

- `xt:active-changed`
  - Owner: `src/scripts/lib/creds.js`
  - Meaning: active playlist changed or refreshed.
  - Typical listeners: pages, sidebar, playlist switcher, settings, search,
    EPG mapping, connection banner.

- `xt:entries-updated`
  - Owner: `src/scripts/lib/creds.js`
  - Meaning: playlist list changed.
  - Typical listeners: playlist switcher, sidebar, settings, live route.
  - Side effect: mirror pins clear in `xtream-api.js`/`creds.js`.

- `xt:catalog-warming-start`
  - Owner: `src/scripts/lib/catalog.js`
  - Meaning: catalog warmup started for playlist/kinds.
  - Listener: `CatalogWarmingIndicator.svelte`.

- `xt:catalog-warming-progress`
  - Owner: `src/scripts/lib/catalog.js`
  - Meaning: per-kind warmup status changed.
  - Detail includes playlist ID, kind, status, and optional error.

- `xt:catalog-warming-bytes`
  - Owner: `src/scripts/lib/catalog.js`
  - Meaning: streamed catalog bytes progress.

- `xt:catalog-warmed`
  - Owner: `src/scripts/lib/catalog.js`
  - Meaning: warmup completed.
  - Typical listeners: playlist switcher, home, settings, search.

- `xt:cache-revalidated`
  - Owner: `src/scripts/lib/cache.js`
  - Meaning: cache kind was refreshed.
  - Typical listeners: live, movies, series.

### Preference events

- `xt:favorites-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, id, isFav }`.
  - Listeners: live, movies, series, detail pages, EPG, strips.

- `xt:watchlist-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, id, onWatchlist }`.
  - Listeners: movies, series, detail pages, watchlist views.

- `xt:recents-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind }`.
  - Listeners: live, movies, series, EPG.

- `xt:progress-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail includes playlist ID, kind, id, progress/completion metadata.
  - Listeners: movie/series detail, series list badges, continue watching.

- `xt:hidden-categories-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, categoryId, hidden }`.

- `xt:allowed-categories-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, categoryId?, allowed? }`.

- `xt:category-mode-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, mode }`.

- `xt:epg-sync-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, on }`.

- `xt:channel-epg-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, channelId, tvgId }`.

- `xt:favorites-order-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind }`.

- `xt:view-prefs-changed`
  - Owner: `src/scripts/lib/preferences.js`
  - Detail: `{ playlistId, kind, mode }`.

### EPG events

- `xt:epg-loaded`
  - Owner: `src/scripts/lib/epg-data.js`
  - Meaning: parsed EPG state loaded for playlist.

- `xt:epg-offset-changed`
  - Owner: `src/scripts/lib/epg-data.js`
  - Meaning: timezone offset setting changed.

- `xt:epg-source-status`
  - Owner: `src/scripts/lib/epg-data.js`
  - Meaning: status summary for primary/additional EPG sources.

- `xt:epg-cat-changed`
  - Owner: `category-picker.ts` instance in `epg.ts`.
  - Meaning: active EPG category changed.

### Route-specific category events

- `xt:cat-changed`
  - Owner: live category picker instance.

- `xt:movie-cat-changed`
  - Owner: movies category picker instance.

- `xt:series-cat-changed`
  - Owner: series category picker instance.

### Settings events

- `xt:settings-changed`
  - Owner: `src/scripts/lib/app-settings.js`
  - Meaning: generic app setting changed.

- `xt:perf-mode-changed`
  - Owner: `app-settings.js`.
  - Listener: `focus-glide.ts`, UI effects.

- `xt:progress-retention-changed`
  - Owner: `app-settings.js`.

- `xt:player-backend-changed`
  - Owner: `app-settings.js`.

- `xt:close-to-tray-changed`
  - Owner: `app-settings.js`.

- `xt:hub-strips-changed`
  - Owner: `app-settings.js`.

- `xt:tv-overscan-changed`
  - Owner: `app-settings.js`.

- `xt:discord-rpc-changed`
  - Owner: `app-settings.js`.

### Download events

- `xt:downloads-changed`
  - Owner: `src/scripts/lib/downloads.js`.

- `xt:download-progress`
  - Owner: `src/scripts/lib/downloads.js`.

- `xt:throughput-tick`
  - Owner: `src/scripts/lib/downloads.js`.

### Platform/player events

- `xt:tray:navigate`
  - Owner: Rust `tray.rs`.
  - Listener: `tray-handler.ts`.

- `xt:tray:hidden-to-tray`
  - Owner: Rust `tray.rs`.

- `xt:player-fallback`
  - Owner: `player-runtime.ts`.
  - Meaning: requested player backend fell back.

- `xt:user-info-loaded`
  - Owner: `account-info.js`.

- `xt:locale-changed`
  - Owner: `i18n.ts`.

## LocalStorage/storage key index

### Playlist and prefs

- `xt_playlists`
  - Owner: `creds.js`.
  - Shape: `{ entries, selectedId }`.

- `xt_prefs`
  - Owner: `preferences.js`.
  - Shape: playlist ID map of favorites, watchlist, recents, progress, category
    filters, EPG mapping, sort prefs.

- `.xtream.creds.json`
  - Tauri plugin-store file used by `creds.js` and `preferences.js` as native
    persistence, mirrored to browser storage.

### Cache

- IndexedDB database `xt_cache`
  - Owner: `cache.js`.
  - Store: `entries`.
  - Key format: `xt_cache:<entryId>:<kind>`.

- `xt_cache_last_pruned_at`
  - Owner: `cache.js`.
  - Lazy prune sentinel.

- `xt_cache_meta`
  - Legacy cache metadata key retained for cleanup.

### EPG

- `xt_epg_offset:<playlistId>`
  - Owner: `epg-data.js`.
  - Stores manual/auto offset setting.

- `xt_epg_http:<playlistId>`
  - Owner: `epg-data.js`.
  - Stores conditional HTTP metadata per EPG source.

- `xt_m3u_epg:<playlistId>`
  - Owner: `catalog.js`/`epg-data.js`.
  - Stores M3U header `x-tvg-url`.

### App settings

- `xt_user_agent`
- `xt_download_dir`
- `xt_download_concurrency`
- `xt_perf_mode`
- `xt_progress_retention_days`
- `xt_player_backend`
- `xt_player_path_mpv`
- `xt_player_path_vlc`
- `xt_player_args_mpv`
- `xt_player_args_vlc`
- `xt_player_reuse_mpv`
- `xt_player_reuse_vlc`
- `xt_close_to_tray`
- `xt_hub_strips`
- `xt_tv_overscan`
- `xt_discord_client_id`
- `xt_discord_muted`

Owner: `app-settings.js`.

### Locale/theme/first-paint keys

- `xt_locale`
- `xt_locale_messages_v3`
- `xt_theme`
- `xt_font_scale`
- `xt_channels_w`
- `xt_perf_mode_auto`
- `xt_tv_overscan_auto`
- `xt_splash_done` in sessionStorage

Owners: `Layout.astro`, `i18n.ts`, settings UI.

### Active category keys

- `xt_vod_active_cat`
- `xt_series_active_cat`
- `xt_epg_active_cat`
- live category key is configured by live category picker instance.

Owner: `category-picker.ts` instances.

## Cache kind index

Common cache kinds:

- `live`: Xtream live channel catalog.
- `m3u`: M3U live channel catalog.
- `vod`: Xtream VOD/movie catalog.
- `series`: Xtream series catalog.
- `epg_parsed:<hash>`: parsed XMLTV map per source URL.
- `series_info_<seriesId>`: series detail info.
- VOD detail cache kinds are used by movie detail route for provider metadata.

Rules:

- Cache kinds are always scoped by playlist ID.
- `invalidateEntry(entryId)` should run after playlist edit/removal.
- `hydrate(entryId, kind)` is needed after navigation before reading cache.

