/** VOD helpers: HLS sibling URLs and light reachability probes. */

import { log, redactUrl } from "@/scripts/lib/log.js"
import {
  useDevStreamProxy,
  wrapStreamUrlForDev,
  devProxyFetchHeaders,
  isAppleEmbedded,
  preferPlainHttpForXtreamMedia,
} from "@/scripts/lib/stream-proxy"

const PROBE_MS = 5000
const PROBE_BYTES = 2048
const OFFLINE_FALLBACK_RE = /\b(TS_OFFLINE|offline|demo|placeholder)\b/i

interface HlsProbeResult {
  reachable: boolean
  url: string
  mediaLines: number
  subtitleLines: number
  audioLines: number
}

function emitVodChoice(reason: string, originalUrl: string, selectedUrl: string): void {
  try {
    document.dispatchEvent(
      new CustomEvent("xt:vod-source-choice", {
        detail: {
          reason,
          originalUrl: redactUrl(originalUrl),
          selectedUrl: redactUrl(selectedUrl),
          changed: originalUrl !== selectedUrl,
        },
      }),
    )
  } catch {}
}

/** Same Xtream path with `.m3u8` instead of `.mkv` / `.mp4` (multi-track HLS). */
function alignSiblingScheme(containerUrl: string, siblingUrl: string): string {
  try {
    const container = new URL(containerUrl)
    const sibling = new URL(siblingUrl)
    sibling.protocol = container.protocol
    sibling.port = container.port
    return sibling.href
  } catch {
    return siblingUrl
  }
}

function toSiblingUrl(url: string, ext: "m3u8" | "mp4"): string | null {
  if (!url) return null
  const stripped = url.split("?")[0] ?? ""
  if (new RegExp(`\\.${ext}$`, "i").test(stripped)) return null
  const sibling = url.replace(/\.(mkv|mp4|avi|ts)(\?|#|$)/i, `.${ext}$2`)
  if (sibling === url) return null
  return alignSiblingScheme(url, sibling)
}

function forceScheme(url: string, protocol: "http:" | "https:"): string | null {
  try {
    const parsed = new URL(url)
    parsed.protocol = protocol
    if (protocol === "http:" && parsed.port === "443") parsed.port = ""
    if (protocol === "https:" && parsed.port === "80") parsed.port = ""
    return parsed.href
  } catch {
    return null
  }
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function looksLikeOfflineFallback(value: string): boolean {
  return OFFLINE_FALLBACK_RE.test(value)
}

function hlsSiblingCandidates(originalUrl: string, normalizedUrl: string): string[] {
  const normalizedSibling = toHlsSiblingUrl(normalizedUrl)
  const originalSibling = toHlsSiblingUrl(originalUrl)
  return uniqueUrls([
    normalizedSibling,
    originalSibling,
    normalizedSibling ? forceScheme(normalizedSibling, "https:") : null,
    originalSibling ? forceScheme(originalSibling, "https:") : null,
    normalizedSibling ? forceScheme(normalizedSibling, "http:") : null,
    originalSibling ? forceScheme(originalSibling, "http:") : null,
  ])
}

export function toHlsSiblingUrl(url: string): string | null {
  return toSiblingUrl(url, "m3u8")
}

export function toMp4SiblingUrl(url: string): string | null {
  return toSiblingUrl(url, "mp4")
}

/** Xtream VOD paths usually expose an `.m3u8` next to the container file. */
export function isXtreamVodContainerUrl(url: string): boolean {
  if (!url) return false
  try {
    const path = new URL(url).pathname.toLowerCase()
    return (
      /\/(movie|series)\/[^/]+\/[^/]+\/\d+\.(mkv|mp4|avi|ts)$/i.test(path) ||
      /\/(movie|series)\/[^/]+\/[^/]+\/[^/]+\.(mkv|mp4|avi|ts)$/i.test(path)
    )
  } catch {
    return /\/(movie|series)\//i.test(url) && /\.(mkv|mp4|avi|ts)(\?|#|$)/i.test(url)
  }
}

async function buildProbeHeaders(upstreamUrl: string): Promise<Headers> {
  const headers = new Headers()
  try {
    const { resolveMediaHeaders } = await import(
      "@/scripts/lib/embedded-media-fetch.js"
    )
    const media = resolveMediaHeaders(upstreamUrl)
    media.forEach((value, key) => headers.set(key, value))
  } catch {
    try {
      headers.set("Referer", `${new URL(upstreamUrl).origin}/`)
    } catch {}
  }
  if (useDevStreamProxy()) {
    const proxyHdrs = devProxyFetchHeaders(headers) as Record<string, string>
    for (const [key, value] of Object.entries(proxyHdrs)) {
      headers.set(key, value)
    }
  }
  return headers
}

async function probeReachable(url: string): Promise<HlsProbeResult> {
  const failed = (): HlsProbeResult => ({
    reachable: false,
    url,
    mediaLines: 0,
    subtitleLines: 0,
    audioLines: 0,
  })
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_MS) : null
  try {
    let target = url
    if (useDevStreamProxy()) {
      target = wrapStreamUrlForDev(url)
    }
    const headers = await buildProbeHeaders(url)
    const { providerFetch } = await import("@/scripts/lib/provider-fetch.js")
    // When the dev proxy is active, `target` is a relative /__stream URL that
    // the Tauri HTTP plugin (Rust) cannot resolve. Use native fetch instead.
    const response = await providerFetch(target, {
      method: "GET",
      headers,
      signal: controller?.signal,
      forceTauri: !useDevStreamProxy(),
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      try {
        response.body?.cancel?.()
      } catch {}
      return failed()
    }

    const ct = (response.headers.get("content-type") || "").toLowerCase()
    if (
      response.ok ||
      response.status === 206 ||
      ct.includes("mpegurl") ||
      ct.includes("m3u8")
    ) {
      let snippet = ""
      try {
        const buf = await response.arrayBuffer()
        snippet = new TextDecoder().decode(buf.slice(0, PROBE_BYTES))
      } catch {}
      try {
        response.body?.cancel?.()
      } catch {}
      const mediaLines = snippet.match(/^#EXT-X-MEDIA:.*$/gim)?.length || 0
      const subtitleLines = snippet.match(/^#EXT-X-MEDIA:.*TYPE=SUBTITLES.*$/gim)?.length || 0
      const audioLines = snippet.match(/^#EXT-X-MEDIA:.*TYPE=AUDIO.*$/gim)?.length || 0
      if (snippet.includes("#EXTM3U") || snippet.includes("#EXT-X-")) {
        return { reachable: true, url, mediaLines, subtitleLines, audioLines }
      }
      if (response.ok && ct.includes("mpegurl")) {
        return { reachable: true, url, mediaLines, subtitleLines, audioLines }
      }
    }
    try {
      response.body?.cancel?.()
    } catch {}
    return failed()
  } catch {
    return failed()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function probeNativeMp4Playable(url: string): Promise<boolean> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_MS) : null
  try {
    let target = url
    if (useDevStreamProxy()) {
      target = wrapStreamUrlForDev(url)
    }
    const headers = await buildProbeHeaders(url)
    headers.set("Range", "bytes=0-2047")
    const { providerFetch } = await import("@/scripts/lib/provider-fetch.js")
    const response = await providerFetch(target, {
      method: "GET",
      headers,
      signal: controller?.signal,
      forceTauri: !useDevStreamProxy(),
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      try {
        response.body?.cancel?.()
      } catch {}
      return false
    }
    if (response.ok || response.status === 206) {
      try {
        const finalUrl = (response as Response).url || ""
        if (looksLikeOfflineFallback(finalUrl)) {
          return false
        }
      } catch {}
      let snippet = ""
      try {
        const buf = await response.arrayBuffer()
        snippet = new TextDecoder("latin1").decode(buf.slice(0, PROBE_BYTES))
      } catch {}
      try {
        response.body?.cancel?.()
      } catch {}
      if (looksLikeOfflineFallback(snippet)) return false
      return snippet.includes("ftyp")
    }
    try {
      response.body?.cancel?.()
    } catch {}
    return false
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface PreferVodHlsOptions {
  /** Try `.m3u8` without probe (only when caller already verified it exists). */
  optimistic?: boolean
}

/**
 * When the panel serves both a file (.mkv/.mp4) and an HLS ladder (.m3u8),
 * prefer the ladder so hls.js can expose audio / subtitle tracks.
 * Default: probe first; on 401/404 keep the container file so playback still works.
 */
export async function preferVodHlsUrl(
  url: string,
  options: PreferVodHlsOptions = {},
): Promise<string> {
  const normalizedUrl = preferPlainHttpForXtreamMedia(url)
  const hlsCandidates = hlsSiblingCandidates(url, normalizedUrl)
  const mp4Sibling = toMp4SiblingUrl(normalizedUrl)
  if (hlsCandidates.length === 0 && !mp4Sibling) return url

  if (hlsCandidates[0] && options.optimistic) {
    const sibling = hlsCandidates[0]
    if (import.meta.env.DEV) {
      log.log("[xt:player] VOD using pre-verified HLS sibling", redactUrl(sibling).slice(0, 120))
    }
    emitVodChoice("hls-optimistic", url, sibling)
    return sibling
  }

  let bestHls: HlsProbeResult | null = null
  for (const candidate of hlsCandidates) {
    const probe = await probeReachable(candidate)
    if (!probe.reachable) continue
    if (!bestHls || probe.mediaLines > bestHls.mediaLines) {
      bestHls = probe
    }
    if (probe.subtitleLines > 0 || probe.audioLines > 0) break
  }

  if (bestHls) {
    const sibling = bestHls.url
    if (import.meta.env.DEV) {
      log.log("[xt:player] VOD HLS sibling verified", {
        url: redactUrl(sibling).slice(0, 120),
        mediaLines: bestHls.mediaLines,
        audioLines: bestHls.audioLines,
        subtitleLines: bestHls.subtitleLines,
      })
    }
    emitVodChoice(
      bestHls.mediaLines > 0 ? "hls-tracks-verified" : "hls-verified",
      url,
      sibling,
    )
    return sibling
  }

  if (
    mp4Sibling &&
    mp4Sibling !== normalizedUrl &&
    isAppleEmbedded() &&
    /\.(mkv|avi|ts)(\?|#|$)/i.test(normalizedUrl.split("?")[0] ?? "")
  ) {
    const mp4Playable = await probeNativeMp4Playable(mp4Sibling)
    if (mp4Playable) {
      if (import.meta.env.DEV) {
        log.log("[xt:player] VOD MP4 sibling verified for Apple WebKit", redactUrl(mp4Sibling).slice(0, 120))
      }
      emitVodChoice("apple-mp4-verified", url, mp4Sibling)
      return mp4Sibling
    }
  }

  if (import.meta.env.DEV) {
    log.warn("[xt:player] VOD HLS sibling unavailable; using original", redactUrl(url).slice(0, 120))
  }

  emitVodChoice("original", url, normalizedUrl)
  return normalizedUrl
}
