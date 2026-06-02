import { describe, expect, it } from "vitest"
import {
  isExcludedCatalogTitle,
  orderCategoryNames,
  parseXtreamCategories,
} from "../src/scripts/lib/category-order.ts"

describe("isExcludedCatalogTitle", () => {
  it("rejects titles starting with ----", () => {
    expect(isExcludedCatalogTitle("---- Italia ----")).toBe(true)
    expect(isExcludedCatalogTitle("----")).toBe(true)
  })

  it("rejects M3U group markers", () => {
    expect(isExcludedCatalogTitle("----Italia----")).toBe(true)
  })

  it("allows normal titles", () => {
    expect(isExcludedCatalogTitle("The Matrix")).toBe(false)
    expect(isExcludedCatalogTitle("Inception (2010)")).toBe(false)
  })
})

describe("parseXtreamCategories", () => {
  it("preserves API order and skips separator categories", () => {
    const { map, order } = parseXtreamCategories([
      { category_id: "10", category_name: "Azione" },
      { category_id: "20", category_name: "---- VOD ----" },
      { category_id: "30", category_name: "Commedia" },
    ])
    expect(order).toEqual(["Azione", "Commedia"])
    expect(map.get("10")).toBe("Azione")
    expect(map.get("30")).toBe("Commedia")
  })
})

describe("orderCategoryNames", () => {
  it("ignores item order when API order is present", () => {
    const counts = new Map([
      ["Alpha", 1],
      ["Beta", 1],
    ])
    const items = [{ category: "Beta" }, { category: "Alpha" }]
    const names = orderCategoryNames(
      counts,
      items,
      ["Zeta", "Beta"],
      "Uncategorized",
    )
    expect(names).toEqual(["Beta", "Alpha"])
  })

  it("uses API order before first-seen in items", () => {
    const counts = new Map([
      ["Beta", 1],
      ["Alpha", 2],
      ["Gamma", 1],
    ])
    const items = [
      { category: "Gamma" },
      { category: "Alpha" },
      { category: "Beta" },
    ]
    const names = orderCategoryNames(
      counts,
      items,
      ["Beta", "Alpha"],
      "Uncategorized",
    )
    expect(names).toEqual(["Beta", "Alpha", "Gamma"])
  })
})
