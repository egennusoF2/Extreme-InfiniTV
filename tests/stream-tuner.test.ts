import { beforeEach, describe, expect, it, vi } from "vitest"

const status = new Map<string, "online" | "offline" | "unknown">()

vi.mock("../src/scripts/lib/stream-state-cache.js", () => ({
  getStreamStatus: (url: string) => status.get(url) ?? null,
  setStreamStatus: (url: string, value: "online" | "offline" | "unknown") => {
    status.set(url, value)
  },
}))

vi.mock("../src/scripts/lib/stream-probe.js", async () => {
  const actual = await vi.importActual<typeof import("../src/scripts/lib/stream-probe")>(
    "../src/scripts/lib/stream-probe",
  )
  return {
    ...actual,
    probeStreamKind: vi.fn(async (url: string) => {
      if (url.includes("bad")) throw new Error("offline")
      if (url.includes("dash")) return "dash"
      if (url.includes("mp4")) return "native"
      return "hls"
    }),
  }
})

describe("stream-tuner", () => {
  beforeEach(() => {
    status.clear()
    vi.clearAllMocks()
  })

  it("sorts preferred and online streams before unknown and offline streams", async () => {
    status.set("https://cdn.example/offline.m3u8", "offline")
    status.set("https://cdn.example/online.m3u8", "online")
    const { sortStreamEntries } = await import("../src/scripts/lib/stream-tuner")

    const sorted = sortStreamEntries(
      [
        { url: "https://cdn.example/offline.m3u8" },
        { url: "https://cdn.example/unknown.mp4" },
        { url: "https://cdn.example/online.m3u8" },
        { url: "https://cdn.example/preferred.m3u8" },
      ],
      {
        preferredUrl: "https://cdn.example/preferred.m3u8",
        preferredFormat: "native",
      },
    )

    expect(sorted.map((entry) => entry.url)).toEqual([
      "https://cdn.example/preferred.m3u8",
      "https://cdn.example/online.m3u8",
      "https://cdn.example/unknown.mp4",
      "https://cdn.example/offline.m3u8",
    ])
  })

  it("returns the first reachable stream and marks failures offline", async () => {
    const { findBestStream } = await import("../src/scripts/lib/stream-tuner")

    const result = await findBestStream(
      [
        { url: "https://cdn.example/bad.m3u8" },
        { url: "https://cdn.example/good.m3u8" },
      ],
      { concurrency: 1, timeoutMs: 100 },
    )

    expect(result).toMatchObject({
      url: "https://cdn.example/good.m3u8",
      kind: "hls",
    })
    expect(status.get("https://cdn.example/bad.m3u8")).toBe("offline")
    expect(status.get("https://cdn.example/good.m3u8")).toBe("online")
  })
})
