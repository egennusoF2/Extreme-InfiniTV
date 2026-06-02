const STORAGE_KEY = "xt:stream-state"
const TTL_MS = 6 * 60 * 60 * 1000
const MAX_ENTRIES = 2048
const MIN_SAVE_INTERVAL_MS = 30_000

export type StreamStatus = "online" | "offline" | "unknown"

interface StreamEntry {
  status: StreamStatus
  updatedAt: number
  position?: number
  duration?: number
}

type StateMap = Record<string, StreamEntry>

let state: StateMap = {}
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSaveAt = 0

function storageAvailable(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null
  } catch {
    return null
  }
}

export function loadStreamState(): void {
  if (loaded) return
  loaded = true
  try {
    const storage = storageAvailable()
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw) state = JSON.parse(raw) as StateMap
    pruneExpired()
  } catch {
    state = {}
  }
}

export function getStreamStatus(url: string): StreamStatus | null {
  if (!url) return null
  loadStreamState()
  const entry = state[url]
  if (!entry) return null
  if (Date.now() - entry.updatedAt > TTL_MS) return null
  return entry.status
}

export function setStreamStatus(
  url: string,
  status: StreamStatus,
  extra: { position?: number; duration?: number } = {},
): void {
  if (!url) return
  loadStreamState()
  const existing = state[url] || {}
  state[url] = {
    ...existing,
    status,
    updatedAt: Date.now(),
    ...extra,
  }
  scheduleSave()
}

export function getResumePosition(url: string): number | null {
  if (!url) return null
  loadStreamState()
  const entry = state[url]
  if (!entry || !entry.position || !entry.duration) return null
  const creditsThreshold = Math.min(180, Math.max(entry.duration * 0.05, 30))
  if (entry.position > entry.duration - creditsThreshold) return null
  if (entry.position < 5) return null
  return entry.position
}

export function setResumePosition(
  url: string,
  position: number,
  duration: number,
): void {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return
  if (duration <= 0) return
  setStreamStatus(url, "online", { position, duration })
}

function pruneExpired(): void {
  const now = Date.now()
  for (const key of Object.keys(state)) {
    if (now - state[key].updatedAt > TTL_MS) delete state[key]
  }

  const keys = Object.keys(state)
  if (keys.length <= MAX_ENTRIES) return
  keys
    .sort((a, b) => state[a].updatedAt - state[b].updatedAt)
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((key) => delete state[key])
}

function scheduleSave(): void {
  const delay = Math.max(0, lastSaveAt + MIN_SAVE_INTERVAL_MS - Date.now())
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    pruneExpired()
    try {
      storageAvailable()?.setItem(STORAGE_KEY, JSON.stringify(state))
      lastSaveAt = Date.now()
    } catch {}
  }, delay)
}
