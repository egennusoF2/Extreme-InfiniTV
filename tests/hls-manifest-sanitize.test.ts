import { describe, expect, it } from "vitest"
import {
  codecsLooksDolbyDigital,
  codecsLooksHevc,
  sanitizeTvMasterPlaylistIfNeeded,
} from "../src/scripts/lib/hls-manifest-sanitize"

describe("hls-manifest-sanitize", () => {
  it("detects HEVC and Dolby codec strings", () => {
    expect(codecsLooksHevc("hvc1.1.6.L93.B0,mp4a.40.2")).toBe(true)
    expect(codecsLooksHevc("avc1.64001f,mp4a.40.2")).toBe(false)
    expect(codecsLooksDolbyDigital("avc1.64001f,ec-3")).toBe(true)
    expect(codecsLooksDolbyDigital("avc1.64001f,mp4a.40.2")).toBe(false)
  })

  it("removes HEVC and Dolby variants when compatible alternatives exist", () => {
    const input = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"',
      "hevc.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=900,CODECS="avc1.64001f,ec-3"',
      "dolby.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=800,CODECS="avc1.64001f,mp4a.40.2"',
      "safe.m3u8",
    ].join("\n")

    const output = sanitizeTvMasterPlaylistIfNeeded(input)

    expect(output).toContain("safe.m3u8")
    expect(output).not.toContain("hevc.m3u8")
    expect(output).not.toContain("dolby.m3u8")
  })

  it("keeps HEVC-only manifests intact", () => {
    const input = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"',
      "hevc-a.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=900,CODECS="hev1.1.6.L93.B0,mp4a.40.2"',
      "hevc-b.m3u8",
    ].join("\n")

    expect(sanitizeTvMasterPlaylistIfNeeded(input)).toBe(input)
  })
})
