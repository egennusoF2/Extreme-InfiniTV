---
layout: ../layouts/DocsLayout.astro
title: "Keyboard + D-pad"
description: "Shortcuts for desktop and spatial navigation for TV remotes."
lede: "The whole app is built for D-pad-first navigation. Keyboard users get the same model with arrow keys, plus extra shortcuts."
---

Press <kbd>?</kbd> anywhere in the app to see the full list of shortcuts in context. This page covers the highlights.

## Global

| Action | Shortcut |
|---|---|
| Search | <kbd>Ctrl</kbd> <kbd>K</kbd> (Windows / Linux) or <kbd>Cmd</kbd> <kbd>K</kbd> (macOS) |
| Show shortcut overlay | <kbd>?</kbd> |
| Navigate between focusable elements | <kbd>Tab</kbd>, <kbd>Shift</kbd> <kbd>Tab</kbd> |
| Spatial focus (any direction) | <kbd>Up</kbd> / <kbd>Down</kbd> / <kbd>Left</kbd> / <kbd>Right</kbd> arrow keys |
| Activate focused element | <kbd>Enter</kbd> or <kbd>Space</kbd> |
| Go back | <kbd>Esc</kbd> / D-pad **Back** / Android system back |

## Live TV

| Action | Shortcut |
|---|---|
| Move within the channel list | <kbd>Up</kbd> / <kbd>Down</kbd> |
| Jump a page | <kbd>PgUp</kbd> / <kbd>PgDn</kbd> |
| Jump to top / bottom | <kbd>Home</kbd> / <kbd>End</kbd> |
| Tune the focused channel | <kbd>Enter</kbd> |
| Toggle favorite on the focused channel | <kbd>F</kbd> |

## Player

| Action | Shortcut |
|---|---|
| Play / pause | <kbd>Space</kbd> |
| Seek 10s | <kbd>Left</kbd> / <kbd>Right</kbd> |
| Volume | <kbd>Up</kbd> / <kbd>Down</kbd> |
| Mute | <kbd>M</kbd> |
| Fullscreen | <kbd>F</kbd> |
| Picture-in-picture | <kbd>P</kbd> |
| Exit fullscreen | <kbd>Esc</kbd> |

> On Android, PiP entry requires fullscreen first - that is how the custom view captures only the video surface and not the whole WebView.

## TV / D-pad context

The whole UI is wired for spatial navigation via `spatial-navigation-polyfill`. On Android TV and other 10-foot contexts, the standard remote works without configuration:

- **D-pad arrows** move focus by spatial proximity, not DOM order. A row of posters above a row of posters lets you go straight up and down.
- **OK / Select** activates the focused element.
- **Back** closes dialogs, drops out of the player, and walks back through the navigation history.
- **Media keys** (Play / Pause / FF / RW) route to the player when one is active.

Hit targets are at least 44x44 px and focus rings are visible at 3 m. You should never need a mouse on a TV.

## Window state and tray (desktop)

- **Close to tray** - **Settings > General** lets you close the window into the system tray instead of quitting. The tray icon's menu has Show / Quit. The first time you close to tray, the app shows a one-time notification so you know it is still running.
- **Window geometry** (size, maximized, fullscreen) is restored across launches. **Visibility** intentionally is not - the app always launches visible, never silently into the tray.
