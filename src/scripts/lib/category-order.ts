/**
 * Xtream category / catalogue ordering helpers.
 * Provider order is preserved; alphabetical sort is opt-in via view sort.
 */

/** Hide separator rows and empty titles in movie/series grids. */
export function isExcludedCatalogTitle(name: unknown): boolean {
  const value = String(name ?? "").trim()
  if (!value) return true
  if (value.startsWith("----")) return true
  // M3U / panel group markers, e.g. ----Italia----
  if (/^-{2,}\s*[^-].*?-{2,}$/.test(value)) return true
  return false
}

export type XtreamCategoryMaps = {
  map: Map<string, string>
  order: string[]
}

/** Parse `get_*_categories` JSON keeping API order. */
export function parseXtreamCategories(data: unknown): XtreamCategoryMaps {
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { categories?: unknown })?.categories)
      ? (data as { categories: unknown[] }).categories
      : []
  const map = new Map<string, string>()
  const order: string[] = []
  const seen = new Set<string>()
  for (const row of arr) {
    const c = row as { category_id?: unknown; category_name?: unknown }
    if (!c || c.category_id == null) continue
    const name = String(c.category_name || "").trim()
    if (!name || isExcludedCatalogTitle(name)) continue
    map.set(String(c.category_id), name)
    if (!seen.has(name)) {
      seen.add(name)
      order.push(name)
    }
  }
  return { map, order }
}

export interface CategoryOrderItem {
  category?: string | null
}

/** M3U / fallback: first appearance in the catalogue list. */
export function categoryOrderFromItems(
  items: CategoryOrderItem[],
  uncategorizedLabel: string,
): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const name = String(item.category || "").trim() || uncategorizedLabel
    if (!name || seen.has(name) || isExcludedCatalogTitle(name)) continue
    seen.add(name)
    order.push(name)
  }
  return order
}

/**
 * Category names for the picker: API order first, then first-seen in items.
 */
export function orderCategoryNames(
  counts: Map<string, number>,
  items: CategoryOrderItem[],
  apiOrder: string[],
  uncategorizedLabel: string,
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    if (!name || seen.has(name) || !counts.has(name)) return
    seen.add(name)
    result.push(name)
  }
  for (const name of apiOrder) add(name)
  // When the provider list is loaded, do not derive order from catalogue items
  // (cached rows may still be alphabetically sorted from older builds).
  if (!apiOrder.length) {
    for (const item of items) {
      const key = String(item.category || "").trim() || uncategorizedLabel
      add(key)
    }
  }
  for (const name of counts.keys()) add(name)
  return result
}
