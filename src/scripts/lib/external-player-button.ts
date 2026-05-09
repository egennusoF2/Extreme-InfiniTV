// Shared escape-hatch button: "Open in MPV/VLC" while keeping Video.js
// (or HTML5) as the default backend. The button hides itself when the
// current backend is already external, when no external player is
// configured, or on web/Android where external launch is impossible.
//
// Each call site supplies a getter for the current source URL (and
// optional headers) plus a "before launch" hook so embedded playback can
// be paused before the external window grabs focus.

import { log } from "@/scripts/lib/log.js"
import {
  getPlayerBackend,
  getPlayerPath,
  PLAYER_BACKEND_EVENT,
  EXTERNAL_PLAYER_BACKENDS,
} from "@/scripts/lib/app-settings.js"
import {
  getExternalLauncher,
  externalPlayersAvailable,
  PlayerLaunchError,
  PlayerNotConfiguredError,
  type ExternalPlayerKind,
  type ExternalLaunchOptions,
} from "@/scripts/lib/player-runtime.ts"
import { toast, toastError } from "@/scripts/lib/toast.js"
import { t, LOCALE_EVENT } from "@/scripts/lib/i18n.js"

export interface EscapeHatchHooks {
  getSrc(): string | null | undefined
  getHeaders?(): { userAgent?: string | null; referer?: string | null } | null | undefined
  getResumeSeconds?(): number
  beforeLaunch?(kind: ExternalPlayerKind): void
}

function pickPreferredExternal(): ExternalPlayerKind | null {
  for (const kind of EXTERNAL_PLAYER_BACKENDS as ExternalPlayerKind[]) {
    if (getPlayerPath(kind)) return kind
  }
  return null
}

function labelFor(kind: ExternalPlayerKind): string {
  const localized = t("settings.playback.openIn", { player: kind.toUpperCase() })
  if (localized && localized !== "settings.playback.openIn") return localized
  return `Open in ${kind.toUpperCase()}`
}

export interface ExternalPlayerButtonHandle {
  refresh(): void
  dispose(): void
}

/**
 * Wire an escape-hatch button on a player surface. Returns a handle so the
 * caller can refresh visibility when source readiness changes.
 */
export function setupExternalPlayerButton(
  btn: HTMLButtonElement | null,
  hooks: EscapeHatchHooks,
): ExternalPlayerButtonHandle {
  if (!btn) return { refresh: () => {}, dispose: () => {} }

  const labelEl = btn.querySelector<HTMLElement>("[data-label]") || btn

  const refresh = () => {
    if (!externalPlayersAvailable) {
      btn.hidden = true
      return
    }
    const backend = getPlayerBackend()
    if (backend === "mpv" || backend === "vlc") {
      btn.hidden = true
      return
    }
    const preferred = pickPreferredExternal()
    if (!preferred) {
      btn.hidden = true
      return
    }
    if (!hooks.getSrc()) {
      btn.hidden = true
      return
    }
    btn.hidden = false
    btn.dataset.kind = preferred
    labelEl.textContent = labelFor(preferred)
  }

  const onClick = async () => {
    const kind = (btn.dataset.kind as ExternalPlayerKind) || pickPreferredExternal()
    if (!kind) return
    const src = hooks.getSrc()
    if (!src) {
      toastError(t("settings.playback.noSource") || "Nothing to play yet.")
      return
    }
    try {
      hooks.beforeLaunch?.(kind)
    } catch (err) {
      log.warn("[xt:external-btn] beforeLaunch threw:", err)
    }
    const launcher = getExternalLauncher(kind)
    const headers = hooks.getHeaders?.() || null
    const opts: ExternalLaunchOptions = {
      userAgent: headers?.userAgent ?? null,
      referer: headers?.referer ?? null,
      resumeSeconds: hooks.getResumeSeconds?.() ?? 0,
    }
    toast({
      title:
        t("settings.playback.launching", { player: kind.toUpperCase() }) ||
        `Launching ${kind.toUpperCase()}…`,
      duration: 2000,
    })
    try {
      await launcher.launch(src, opts)
    } catch (err) {
      surfaceLaunchError(err, kind)
    }
  }

  btn.addEventListener("click", onClick)
  document.addEventListener(PLAYER_BACKEND_EVENT, refresh)
  document.addEventListener("xt:settings-changed", refresh as EventListener)
  document.addEventListener(LOCALE_EVENT, refresh)

  refresh()

  return {
    refresh,
    dispose() {
      btn.removeEventListener("click", onClick)
      document.removeEventListener(PLAYER_BACKEND_EVENT, refresh)
      document.removeEventListener("xt:settings-changed", refresh as EventListener)
      document.removeEventListener(LOCALE_EVENT, refresh)
    },
  }
}

export function surfaceLaunchError(err: unknown, kind: ExternalPlayerKind): void {
  const playerName = kind.toUpperCase()
  if (err instanceof PlayerNotConfiguredError) {
    toastError(
      t("settings.playback.notConfigured", { player: playerName }) ||
        `${playerName} isn't configured. Set its path in Settings → Playback.`,
    )
    return
  }
  if (err instanceof PlayerLaunchError) {
    const key = `settings.playback.error.${err.code.toLowerCase()}`
    const localized = t(key, { player: playerName, path: err.path })
    toastError(
      localized && localized !== key
        ? localized
        : `Couldn't launch ${playerName}: ${err.message}`,
    )
    return
  }
  log.error("[xt:external-btn] launch threw:", err)
  toastError(`Couldn't launch ${playerName}.`)
}
