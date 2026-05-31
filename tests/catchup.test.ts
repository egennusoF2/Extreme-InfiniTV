import { describe, expect, it, vi } from "vitest"
import {
  buildCatchupStreamUrl,
  canReplayProgramme,
} from "../src/scripts/lib/catchup"

describe("catchup helpers", () => {
  const now = new Date(2026, 0, 2, 12, 0, 0).getTime()
  const programme = {
    start: new Date(2026, 0, 2, 10, 0, 0).getTime(),
    stop: new Date(2026, 0, 2, 11, 30, 0).getTime(),
  }

  it("allows ended programmes inside the provider catchup window", () => {
    expect(
      canReplayProgramme({ id: 10, catchup: "xtream", catchupDays: 1 }, programme, now),
    ).toBe(true)
  })

  it("builds Xtream timeshift URLs", () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const url = buildCatchupStreamUrl(
      { id: 42, catchup: "xtream", catchupDays: 7 },
      programme,
      { host: "https://iptv.example.com", user: "u", pass: "p" },
    )
    expect(url).toBe("https://iptv.example.com/timeshift/u/p/90/2026-01-02%3A10-00/42.m3u8")
    vi.useRealTimers()
  })

  it("replaces M3U catchup-source placeholders", () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const start = Math.floor(programme.start / 1000)
    const stop = Math.floor(programme.stop / 1000)
    const timestamp = Math.floor(now / 1000)
    const url = buildCatchupStreamUrl(
      {
        id: 1,
        catchup: "default",
        catchupDays: 7,
        catchupSource: "https://example.com/replay/${start}/${end}/${duration}/${timestamp}",
      },
      programme,
    )
    expect(url).toBe(`https://example.com/replay/${start}/${stop}/5400/${timestamp}`)
    vi.useRealTimers()
  })
})
