# Native Tauri and Android guide

## Tauri startup

File: `src-tauri/src/lib.rs`

`run()` builds the app with common plugins:

- notification
- clipboard-manager
- store
- http
- fs
- dialog
- opener

Desktop-only additions:

- window-state plugin
- updater plugin
- Discord RPC state and commands
- external player state and command
- tray command

Android-only addition:

- `tauri-plugin-android-fs`

Setup behavior:

- Debug desktop logging.
- Sweep orphan MPV sockets on desktop.
- Install tray on desktop.
- Hide native decorations, enable shadow, show/focus main window.

## Desktop tray

File: `src-tauri/src/tray.rs`

Responsibilities:

- Install system tray icon and menu.
- Left-click toggles main window.
- Menu navigates to Live TV, Movies, Series, Search, Guide, Downloads, Settings.
- Emits `xt:tray:navigate` route event to frontend.
- Intercepts close request and hides window when close-to-tray is enabled.
- Exposes command `set_close_to_tray(enabled)`.

Frontend counterpart: `src/scripts/lib/tray-handler.ts`.

Settings counterpart: `src/scripts/lib/app-settings.js`.

## External player bridge

File: `src-tauri/src/external_player.rs`

Tauri command:

```rust
launch_external_player(path, args, mode, reuse)
```

Modes:

- `detect`: run binary with `--version`, timeout after 2 seconds.
- `exists`: verify path exists.
- `launch`: spawn or reuse external player.

Error prefixes:

- `NOT_FOUND`
- `PERMISSION`
- `TIMEOUT`
- `OTHER`
- `IPC` for reuse IPC send failures internally.

MPV reuse:

- Creates socket/pipe endpoint.
- Adds `--input-ipc-server=<endpoint>` and `--idle=yes`.
- Sends JSON IPC `loadfile` command on subsequent launches.
- Encodes user-agent/referrer in MPV percent-length option syntax.
- Cleans stale slots and old Unix sockets.

VLC reuse:

- Adds `--one-instance` and `--no-playlist-enqueue`.
- Removes `--play-and-exit`.
- Tracks pid liveness.

Safety:

- Path and args reject NUL/newline/carriage return.
- Process spawn is shell-free.
- Unit tests cover argv augmentation, IPC command construction, validation,
  path checks, lock behavior, pid zero.

Frontend counterpart: `src/scripts/lib/player-runtime.ts`,
`src/components/PlayerPicker.svelte`.

## Discord Rich Presence bridge

File: `src-tauri/src/discord.rs`

Commands:

- `discord_set_activity`
- `discord_clear`
- `discord_disconnect`

Behavior:

- Lazily opens Discord IPC client per configured app/client ID.
- Reuses active client until client ID changes.
- Supports details, state text, large/small assets, timestamps, and up to two
  buttons.
- Desktop-only by cfg gate.

Frontend counterpart: `src/scripts/lib/discord-rpc.js`,
settings in `app-settings.js`.

## Android bridge

File: `src-tauri/gen/android/app/src/main/java/com/infinitel8p/xtream/MainActivity.kt`

Responsibilities:

- Host Tauri Android WebView activity.
- Expose JavaScript interfaces used by frontend for Android-specific behavior.
- Support Android intent playback handoff.
- Support device/platform/status-bar information used by layout and player.

Frontend counterpart:

- `src/scripts/lib/player-runtime.ts` for Android handoff.
- `src/scripts/lib/android-fs.js` for Android filesystem plugin use.
- `src/layouts/Layout.astro` for Android platform/status-bar first-paint logic.

## Capabilities and permissions

Files:

- `src-tauri/capabilities/default.json`
- `src-tauri/capabilities/desktop.json`
- `src-tauri/capabilities/android.json`

Rules:

- Add new permissions deliberately.
- Keep desktop-only commands out of Android where not supported.
- Test command availability from frontend guards.
- Do not assume Tauri plugin is available in web preview.

## Android generated files

Tauri Android generated files live under `src-tauri/gen/android`.

Important files:

- `app/build.gradle.kts`
- `build.gradle.kts`
- `settings.gradle`
- `gradle.properties`
- `AndroidManifest.xml`
- `network_security_config.xml`
- `file_paths.xml`
- `buildSrc/.../BuildTask.kt`
- `buildSrc/.../RustPlugin.kt`

Treat most of this as generated platform scaffolding. Edit only when platform
behavior requires it and verify Tauri Android still builds.

## Native change checklist

1. Identify desktop vs Android vs web behavior.
2. Update Rust command registration in `lib.rs` if adding commands.
3. Update Tauri capabilities.
4. Add frontend guards for unavailable native APIs.
5. Add Rust unit tests for pure/native helper logic where possible.
6. Run frontend tests for corresponding JS wrappers.
7. Manually verify `pnpm tauri dev` or `pnpm tauri:android` when environment is
   available.

