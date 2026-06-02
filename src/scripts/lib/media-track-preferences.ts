const AUDIO_KEY = "xt:preferred-audio-track"
const SUBTITLE_KEY = "xt:preferred-subtitle-track"

export type MediaTrackKind = "audio" | "subtitle"

export interface MediaTrackPreference {
  id?: string
  lang?: string
  name?: string
  label?: string
}

export interface MediaTrackLike {
  id?: string
  lang?: string
  language?: string
  name?: string
  label?: string
}

function storageKey(kind: MediaTrackKind): string {
  return kind === "audio" ? AUDIO_KEY : SUBTITLE_KEY
}

function clean(value: unknown): string {
  return String(value || "").trim()
}

function norm(value: unknown): string {
  return clean(value).toLowerCase()
}

export function preferenceFromTrack(track: MediaTrackLike | null | undefined): MediaTrackPreference {
  return {
    id: clean(track?.id),
    lang: clean(track?.lang || track?.language),
    name: clean(track?.name),
    label: clean(track?.label),
  }
}

export function saveTrackPreference(kind: MediaTrackKind, track: MediaTrackLike): void {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(preferenceFromTrack(track)))
  } catch {}
}

export function clearTrackPreference(kind: MediaTrackKind): void {
  try {
    localStorage.removeItem(storageKey(kind))
  } catch {}
}

export function getTrackPreference(kind: MediaTrackKind): MediaTrackPreference | null {
  try {
    const raw = localStorage.getItem(storageKey(kind))
    if (!raw) return null
    const parsed = JSON.parse(raw) as MediaTrackPreference
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

function trackScore(pref: MediaTrackPreference, track: MediaTrackLike): number {
  const trackId = norm(track.id)
  const trackLang = norm(track.lang || track.language)
  const trackName = norm(track.name)
  const trackLabel = norm(track.label)
  let score = 0
  if (pref.id && trackId && norm(pref.id) === trackId) score += 8
  if (pref.lang && trackLang && norm(pref.lang) === trackLang) score += 6
  if (pref.name && trackName && norm(pref.name) === trackName) score += 4
  if (pref.label && trackLabel && norm(pref.label) === trackLabel) score += 4
  if (pref.lang && !trackLang) {
    const needle = norm(pref.lang)
    if (needle && (trackName.includes(needle) || trackLabel.includes(needle))) score += 2
  }
  return score
}

export function findPreferredTrackIndex(
  kind: MediaTrackKind,
  tracks: ArrayLike<MediaTrackLike> | null | undefined,
): number {
  const pref = getTrackPreference(kind)
  if (!pref || !tracks || tracks.length === 0) return -1
  let bestIndex = -1
  let bestScore = 0
  for (let index = 0; index < tracks.length; index++) {
    const score = trackScore(pref, tracks[index])
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
}
