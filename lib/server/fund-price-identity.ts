import { fundNameCore } from "@/lib/server/fund-picker-search"
import { shareClassFromProductName, type ShareClassLetter } from "@/lib/server/share-class-product"
import { shareClassParentCandidates } from "@/lib/server/compare-funds"

const PRICE_PAGE_CAP = 5000

export function isTestFundProduct(name: string | null | undefined, code: string | null | undefined): boolean {
  const c = String(code ?? "").trim()
  const n = String(name ?? "").trim()
  if (/_test_/i.test(c) || /^test[_-]/i.test(c)) return true
  if (/^test fund\b/i.test(n)) return true
  if (/测试基金|测试产品/.test(n)) return true
  return false
}

/** Drop share-class wording so a name search can find the parent beside its classes. */
export function familySearchText(name: string): string {
  return String(name ?? "")
    .replace(/[（(][^）)]{0,12}[）)]/g, " ")
    .replace(/([ABC]类)?份额/g, " ")
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Collapse 份额 / A类份额 / （B类份额） / 私募证券投资基金 into one family name. */
export function fundFamilyName(name: string): string {
  const stripped = String(name ?? "")
    .replace(/[（(][^）)]{0,12}[）)]/g, "")
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金|集合资产管理计划|资产管理计划)/g, "")
    .replace(/([ABC]类)?份额/g, "")
    .replace(/[ABC]类/g, "")
  return fundNameCore(stripped).replace(/[\s\u3000]+/g, "").toLowerCase()
}

/**
 * Codes to try for a NAV series. Share-class tier codes list the parent first
 * among aliases (AAK83C → SAAK83), and never a longer prefix such as AAK837.
 */
export function priceCodeCandidates(code: string): string[] {
  const upper = String(code ?? "").trim().toUpperCase()
  if (!upper) return []
  const out: string[] = []
  const add = (value: string) => {
    const next = value.trim().toUpperCase()
    if (next && !out.includes(next)) out.push(next)
  }
  const parents = shareClassParentCandidates(upper)
  if (parents) {
    for (const parent of parents.parents) add(parent)
  }
  add(upper)
  const seeds = [...out]
  for (const seed of seeds) {
    if (seed.startsWith("S") && seed.length > 5) add(seed.slice(1))
    else if (!seed.startsWith("S")) add(`S${seed}`)
  }
  return out
}

export function listedPriceFields(code: string, name?: string | null): {
  parent_reg_code: string
  share_class: ShareClassLetter | null
  price_reg_code: string
} {
  const upper = String(code ?? "").trim().toUpperCase()
  const parents = shareClassParentCandidates(upper)
  const share = parents?.letter ?? shareClassFromProductName(String(name ?? ""))
  const parent = parents?.parents[0] ?? upper
  return {
    parent_reg_code: parent,
    share_class: share,
    price_reg_code: parents ? parent : upper,
  }
}

export function sameFundFamily(a: string, b: string): boolean {
  const left = fundFamilyName(a)
  const right = fundFamilyName(b)
  return left.length >= 4 && left === right
}

/** Blank change is null. 0 stays 0. Values are percent points, not decimals. */
export function priceChangePercent(value: unknown): number | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  const n = typeof value === "number" ? value : Number(text)
  return Number.isFinite(n) ? n : null
}

export function nullFirstPriceChange<T extends { price_date: string; price_change: number | null }>(points: T[]): T[] {
  if (points.length === 0) return points
  const sorted = [...points].sort((a, b) => a.price_date.localeCompare(b.price_date) || 0)
  sorted[0] = { ...sorted[0], price_change: null }
  return sorted
}

export function nextPriceDate(iso: string): string | null {
  const day = iso.slice(0, 10)
  const t = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return new Date(t + 86_400_000).toISOString().slice(0, 10)
}

export function pagePricePoints<T extends { price_date: string }>(
  points: T[],
  start: string | null,
  end: string | null,
): { points: T[]; truncated: boolean; next_start_date: string | null } {
  const filtered = points.filter((point) => {
    if (start && point.price_date < start) return false
    if (end && point.price_date > end) return false
    return true
  })
  if (filtered.length <= PRICE_PAGE_CAP) {
    return { points: filtered, truncated: false, next_start_date: null }
  }
  const page = filtered.slice(0, PRICE_PAGE_CAP)
  const last = page[page.length - 1]?.price_date ?? ""
  return { points: page, truncated: true, next_start_date: nextPriceDate(last) }
}

export function parsePriceBulkCursor(cursor: string | null | undefined): { index: number; start: string | null } {
  const raw = String(cursor ?? "").trim()
  if (!raw) return { index: 0, start: null }
  const [indexText, start] = raw.split("@")
  const index = Number(indexText)
  return {
    index: Number.isFinite(index) && index > 0 ? Math.floor(index) : 0,
    start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
  }
}

export function priceBulkCursor(index: number, start: string | null): string {
  return start ? `${index}@${start}` : String(index)
}

export const PRICE_BULK_DEFAULT = 10
export const PRICE_BULK_MAX = 20
