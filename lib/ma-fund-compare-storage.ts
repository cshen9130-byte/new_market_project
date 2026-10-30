import type { PortfolioFundPickerItem } from "@/components/ma/portfolio-fund-picker-dialog"

export interface SavedFundCompareFund {
  beian_hao: string
  product_name: string
  manager: string | null
  fund_type: "私募" | "公募"
  nav_start_date: string | null
  latest_nav_date: string | null
  inception_date: string | null
  ret_ann_since_inception: string | null
}

export interface SavedFundCompare {
  id: string
  name: string
  scope: "team" | "mine"
  funds: SavedFundCompareFund[]
  createdAt: string
  updatedAt: string
}

export interface FundCompareListRow {
  id: string
  name: string
  team_tags: string[]
  fund_count: number
  share_status: string | null
  updated_by: string | null
  updated_date: string | null
  created_by: string | null
  isLocal?: boolean
}

const STORAGE_KEY = "ma_fund_compares"
/** Keep the local list from growing until setItem throws and the new group is dropped. */
const MAX_STORED_COMPARES = 40
const DRAFT_PARAM = "fc"

function currentUserName(): string {
  if (typeof window === "undefined") return ""
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name || u?.email || ""
  } catch {
    return ""
  }
}

export function pickerItemToCompareFund(item: PortfolioFundPickerItem): SavedFundCompareFund {
  return {
    beian_hao: item.beian_hao,
    product_name: item.product_name,
    manager: item.manager,
    fund_type: "私募",
    nav_start_date: item.nav_start_date ?? null,
    latest_nav_date: item.latest_nav_date ?? null,
    inception_date: item.inception_date ?? null,
    ret_ann_since_inception: item.ret_ann_since_inception ?? null,
  }
}

export function defaultCompareName(items: PortfolioFundPickerItem[]): string {
  if (items.length === 0) return "未命名对比"
  if (items.length === 1) return items[0].product_name
  return `${items[0].product_name}等${items.length}只`
}

export function createFundCompareId() {
  return `cmp-${Date.now()}`
}

export function loadAllFundCompares(): SavedFundCompare[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadFundCompare(id: string): SavedFundCompare | null {
  return loadAllFundCompares().find((c) => c.id === id) ?? null
}

function writeCompares(compares: SavedFundCompare[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compares))
    return true
  } catch {
    return false
  }
}

/**
 * Persist a compare group. Returns false when storage is unavailable or the
 * origin quota is already full — callers must not treat that as success.
 * Older groups are dropped before the newest one so one full key does not
 * block the group the user just created.
 */
export function saveFundCompare(compare: SavedFundCompare): boolean {
  if (typeof window === "undefined") return false
  const existing = loadAllFundCompares().filter((item) => item.id !== compare.id)
  const attempts = [
    [compare, ...existing].slice(0, MAX_STORED_COMPARES),
    [compare, ...existing].slice(0, 8),
    [compare],
  ]
  for (const batch of attempts) {
    if (!writeCompares(batch)) continue
    window.dispatchEvent(new Event("ma-fund-compares-updated"))
    return true
  }
  return false
}

export function deleteFundCompare(id: string) {
  if (typeof window === "undefined") return
  try {
    const next = loadAllFundCompares().filter((c) => c.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event("ma-fund-compares-updated"))
  } catch {
    // localStorage may be unavailable
  }
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function savedToListRow(compare: SavedFundCompare): FundCompareListRow {
  return {
    id: compare.id,
    name: compare.name,
    team_tags: [],
    fund_count: compare.funds.length,
    share_status: compare.scope === "team" ? "团队" : "个人",
    updated_by: currentUserName() || null,
    updated_date: fmtDate(compare.updatedAt),
    created_by: currentUserName() || null,
    isLocal: true,
  }
}

export function loadLocalFundCompareRows(
  scope: "team" | "mine",
  keyword = "",
): FundCompareListRow[] {
  const kw = keyword.trim().toLowerCase()
  return loadAllFundCompares()
    .filter((c) => c.scope === scope)
    .filter((c) => !kw || c.name.toLowerCase().includes(kw))
    .map(savedToListRow)
}

export function createFundCompareFromPicker(
  items: PortfolioFundPickerItem[],
  scope: "team" | "mine",
  name?: string,
): SavedFundCompare {
  const now = new Date().toISOString()
  return {
    id: createFundCompareId(),
    name: name?.trim() || defaultCompareName(items),
    scope,
    funds: items.map(pickerItemToCompareFund),
    createdAt: now,
    updatedAt: now,
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isSavedFundCompare(value: unknown): value is SavedFundCompare {
  if (!value || typeof value !== "object") return false
  const row = value as SavedFundCompare
  if (typeof row.id !== "string" || !row.id) return false
  if (row.scope !== "team" && row.scope !== "mine") return false
  if (typeof row.name !== "string") return false
  if (!Array.isArray(row.funds)) return false
  return row.funds.every((fund) => (
    !!fund
    && typeof fund.beian_hao === "string"
    && fund.beian_hao.length > 0
    && typeof fund.product_name === "string"
  ))
}

/** Id from `/fund-compare/cmp-…`, used when `useParams()` has not supplied one. */
export function compareIdFromPathname(pathname: string): string {
  const match = pathname.match(/\/fund-compare\/([^/?#]+)\/?$/)
  return match ? safeDecode(match[1]) : ""
}

export function readCompareDraft(hash: string): SavedFundCompare | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return null
  let encoded: string | null = null
  try {
    encoded = new URLSearchParams(raw).get(DRAFT_PARAM)
  } catch {
    return null
  }
  if (!encoded) return null
  try {
    const parsed: unknown = JSON.parse(encoded)
    return isSavedFundCompare(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Detail links are opened with `window.open(..., "noopener")`. That tab does
 * not share sessionStorage, and `saveFundCompare` can fail when localStorage
 * is over quota. The hash carries the group so the page can still open it.
 */
export function fundCompareHref(compare: SavedFundCompare): string {
  const path = `/ma/dashboard/private-funds/fund-compare/${encodeURIComponent(compare.id)}`
  return `${path}#${DRAFT_PARAM}=${encodeURIComponent(JSON.stringify(compare))}`
}

export function resolveOpenedFundCompare(input: {
  paramId?: string | string[]
  pathname?: string
  hash?: string
}): { id: string; compare: SavedFundCompare | null } {
  const fromParam = Array.isArray(input.paramId) ? input.paramId[0] ?? "" : input.paramId ?? ""
  const id = (fromParam ? safeDecode(fromParam) : "") || (input.pathname ? compareIdFromPathname(input.pathname) : "")
  const stored = id ? loadFundCompare(id) : null
  if (stored) return { id, compare: stored }
  const draft = input.hash ? readCompareDraft(input.hash) : null
  if (draft && (!id || draft.id === id)) return { id: draft.id, compare: draft }
  return { id, compare: null }
}

export function adoptOpenedFundCompare(input: {
  paramId?: string | string[]
  pathname: string
  hash: string
}): { id: string; compare: SavedFundCompare | null; persisted: boolean } {
  const opened = resolveOpenedFundCompare(input)
  if (!opened.compare) return { id: opened.id, compare: null, persisted: false }
  if (loadFundCompare(opened.compare.id)) {
    return { id: opened.compare.id, compare: opened.compare, persisted: true }
  }
  return {
    id: opened.compare.id,
    compare: opened.compare,
    persisted: saveFundCompare(opened.compare),
  }
}
