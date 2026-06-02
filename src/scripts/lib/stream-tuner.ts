import { getStreamStatus, setStreamStatus } from "@/scripts/lib/stream-state-cache.js"
import {
  probeStreamKind,
  streamKindFromUrl,
  type StreamKind,
} from "@/scripts/lib/stream-probe.js"

export interface StreamEntry {
  url: string
  name?: string
  source?: string
}

export interface TunerOptions {
  concurrency?: number
  timeoutMs?: number
  preferredUrl?: string | null
  preferredFormat?: "hls" | "ts" | "dash" | "native" | null
}

export interface TunerResult {
  url: string
  kind: Exclude<StreamKind, "unknown" | "hls-vod"> | "hls-vod"
  responseMs: number
}

function normalizeKind(kind: StreamKind): TunerResult["kind"] {
  if (kind === "unknown") return "hls"
  return kind
}

function matchesPreferredFormat(kind: StreamKind, preferredFormat?: TunerOptions["preferredFormat"]): boolean {
  if (!preferredFormat) return false
  if (kind === "hls-vod" && preferredFormat === "hls") return true
  return kind === preferredFormat
}

/**
 * Megacubo-style priority sort:
 * preferred URL, known online, preferred format, untested, known offline.
 */
export function sortStreamEntries(
  entries: StreamEntry[],
  opts: TunerOptions = {},
): StreamEntry[] {
  const preferred: StreamEntry[] = []
  const online: StreamEntry[] = []
  const byFormat: StreamEntry[] = []
  const unknown: StreamEntry[] = []
  const offline: StreamEntry[] = []

  for (const entry of entries) {
    if (!entry?.url) continue
    if (opts.preferredUrl && entry.url === opts.preferredUrl) {
      preferred.push(entry)
      continue
    }

    const status = getStreamStatus(entry.url)
    if (status === "offline") {
      offline.push(entry)
      continue
    }
    if (status === "online") {
      online.push(entry)
      continue
    }

    if (matchesPreferredFormat(streamKindFromUrl(entry.url), opts.preferredFormat)) {
      byFormat.push(entry)
      continue
    }

    unknown.push(entry)
  }

  return [...preferred, ...online, ...byFormat, ...unknown, ...offline]
}

async function testEntry(
  entry: StreamEntry,
  timeoutMs: number,
): Promise<TunerResult | null> {
  const start = Date.now()
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const kind = await probeStreamKind(entry.url, controller?.signal)
    if (kind === "unknown") return null
    return {
      url: entry.url,
      kind: normalizeKind(kind),
      responseMs: Date.now() - start,
    }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Probe candidate streams in bounded parallel batches and return the first
 * reachable stream. Failed entries are cached as offline for future tuning.
 */
export async function findBestStream(
  entries: StreamEntry[],
  opts: TunerOptions = {},
): Promise<TunerResult | null> {
  const sorted = sortStreamEntries(entries, opts)
  if (sorted.length === 0) return null

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, sorted.length))
  const timeoutMs = opts.timeoutMs ?? 5000

  return new Promise((resolve) => {
    let cursor = 0
    let pending = 0
    let resolved = false

    const launchNext = () => {
      if (resolved) return
      while (pending < concurrency && cursor < sorted.length) {
        const entry = sorted[cursor++]
        pending++
        testEntry(entry, timeoutMs)
          .then((result) => {
            pending--
            if (resolved) return
            if (result) {
              setStreamStatus(entry.url, "online")
              resolved = true
              resolve(result)
              return
            }
            setStreamStatus(entry.url, "offline")
            if (cursor >= sorted.length && pending === 0) {
              resolved = true
              resolve(null)
              return
            }
            launchNext()
          })
          .catch(() => {
            pending--
            setStreamStatus(entry.url, "offline")
            if (!resolved) launchNext()
          })
      }
    }

    launchNext()
  })
}
