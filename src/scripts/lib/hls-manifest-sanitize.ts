interface VariantBlock {
  pre: string[]
  inf: string
  uri: string
}

interface MasterParts {
  header: string[]
  variants: VariantBlock[]
  tail: string[]
}

function codecsFromStreamInf(line: string): string {
  const match = line.match(/\bCODECS=(?:"([^"]+)"|([^,\s]+))/i)
  return (match?.[1] || match?.[2] || "").toLowerCase()
}

export function codecsLooksHevc(codecs: string): boolean {
  const c = codecs.toLowerCase()
  return (
    c.includes("hvc1") ||
    c.includes("hev1") ||
    c.includes("hev.") ||
    c.includes("hevc") ||
    c.includes("h265") ||
    c.includes("dvhe") ||
    c.includes("dvh1")
  )
}

export function codecsLooksDolbyDigital(codecs: string): boolean {
  const c = codecs.toLowerCase().replace(/\s+/g, "")
  return (
    c.includes("ac-3") ||
    c.includes("ac3") ||
    c.includes("ec-3") ||
    c.includes("ec3") ||
    c.includes("eac3") ||
    c.includes("e-ac-3")
  )
}

function parseMasterPlaylist(body: string): MasterParts {
  const lines = body.split(/\r?\n/)
  const header: string[] = []
  const variants: VariantBlock[] = []
  const tail: string[] = []
  let pending: string[] = []
  let seenVariant = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith("#EXT-X-STREAM-INF")) {
      if (seenVariant) pending.push(line)
      else header.push(line)
      continue
    }

    seenVariant = true
    const uri = lines[index + 1] || ""
    variants.push({
      pre: pending,
      inf: line,
      uri,
    })
    pending = []
    index++
  }

  tail.push(...pending)
  return { header, variants, tail }
}

function rebuildMasterPlaylist(parts: MasterParts, variants: VariantBlock[]): string {
  const lines = [...parts.header]
  for (const variant of variants) {
    lines.push(...variant.pre, variant.inf, variant.uri)
  }
  lines.push(...parts.tail)
  return lines.join("\n")
}

/**
 * IPTV master playlists often include browser-incompatible variants.
 * Keep them only when there is no compatible alternative.
 */
export function sanitizeTvMasterPlaylistIfNeeded(body: string): string {
  if (!body.includes("#EXT-X-STREAM-INF")) return body
  const parts = parseMasterPlaylist(body)
  if (parts.variants.length <= 1) return body

  let working = parts.variants
  const initialCodecs = working.map((variant) => codecsFromStreamInf(variant.inf))
  const hasHevc = initialCodecs.some((codecs) => codecsLooksHevc(codecs))
  const hasNonHevc = initialCodecs.some((codecs) => codecs && !codecsLooksHevc(codecs))
  if (hasHevc && hasNonHevc) {
    working = working.filter((variant) => !codecsLooksHevc(codecsFromStreamInf(variant.inf)))
  }

  const remainingCodecs = working.map((variant) => codecsFromStreamInf(variant.inf))
  const hasDolby = remainingCodecs.some((codecs) => codecsLooksDolbyDigital(codecs))
  const hasNonDolby = remainingCodecs.some(
    (codecs) => codecs && !codecsLooksDolbyDigital(codecs),
  )
  if (hasDolby && hasNonDolby) {
    working = working.filter(
      (variant) => !codecsLooksDolbyDigital(codecsFromStreamInf(variant.inf)),
    )
  }

  if (working.length === 0 || working.length === parts.variants.length) return body
  return rebuildMasterPlaylist(parts, working)
}
