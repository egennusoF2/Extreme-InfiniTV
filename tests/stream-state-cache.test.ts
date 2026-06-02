import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getResumePosition,
  getStreamStatus,
  loadStreamState,
  setResumePosition,
  setStreamStatus,
} from "../src/scripts/lib/stream-state-cache"

describe("stream-state-cache", () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
    })
    vi.resetModules()
  })

  it("stores stream online/offline state", () => {
    loadStreamState()
    setStreamStatus("http://example.test/a.m3u8", "online")
    expect(getStreamStatus("http://example.test/a.m3u8")).toBe("online")
  })

  it("returns resume position only for unfinished VOD", () => {
    setResumePosition("http://example.test/movie.mkv", 120, 1000)
    expect(getResumePosition("http://example.test/movie.mkv")).toBe(120)

    setResumePosition("http://example.test/movie.mkv", 980, 1000)
    expect(getResumePosition("http://example.test/movie.mkv")).toBeNull()
  })
})
