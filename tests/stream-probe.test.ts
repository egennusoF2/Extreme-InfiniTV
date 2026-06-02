import { describe, expect, it } from "vitest"
import {
  isVodM3u8,
  streamKindFromUrl,
} from "../src/scripts/lib/stream-probe"

describe("streamKindFromUrl", () => {
  it("uses URL extensions as fast stream hints", () => {
    expect(streamKindFromUrl("http://x.test/a.m3u8")).toBe("hls")
    expect(streamKindFromUrl("http://x.test/a.mpd")).toBe("dash")
    expect(streamKindFromUrl("http://x.test/a.ts")).toBe("ts")
    expect(streamKindFromUrl("http://x.test/a.mkv")).toBe("native")
  })

  it("classifies Xtream live URLs as HLS by default", () => {
    expect(streamKindFromUrl("http://x.test/live/u/p/123")).toBe("hls")
  })

  it("uses MIME as fallback", () => {
    expect(streamKindFromUrl("http://x.test/stream", "video/mp2t")).toBe("ts")
    expect(streamKindFromUrl("http://x.test/stream", "video/mp4")).toBe("native")
  })
})

describe("isVodM3u8", () => {
  it("detects explicit VOD playlists", () => {
    expect(isVodM3u8("#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2,\na.ts")).toBe(true)
  })

  it("treats high media sequence as live", () => {
    expect(isVodM3u8("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:12345\n#EXTINF:2,\na.ts")).toBe(false)
  })

  it("detects long finite segment lists as VOD", () => {
    const body = ["#EXTM3U", ...Array.from({ length: 31 }, (_, i) => `#EXTINF:2,\n${i}.ts`)].join("\n")
    expect(isVodM3u8(body)).toBe(true)
  })
})
