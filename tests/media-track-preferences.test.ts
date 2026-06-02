import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearTrackPreference,
  findPreferredTrackIndex,
  getTrackPreference,
  saveTrackPreference,
} from "../src/scripts/lib/media-track-preferences"

describe("media-track-preferences", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
    })
  })

  it("saves and clears audio preferences", () => {
    saveTrackPreference("audio", { id: "a1", lang: "ita", name: "Italian" })

    expect(getTrackPreference("audio")).toEqual({
      id: "a1",
      lang: "ita",
      name: "Italian",
      label: "",
    })

    clearTrackPreference("audio")
    expect(getTrackPreference("audio")).toBeNull()
  })

  it("finds the best subtitle match by language and label", () => {
    saveTrackPreference("subtitle", { lang: "ita", label: "Italian subtitles" })

    expect(
      findPreferredTrackIndex("subtitle", [
        { language: "eng", label: "English" },
        { language: "ita", label: "Italian" },
      ]),
    ).toBe(1)
  })
})
