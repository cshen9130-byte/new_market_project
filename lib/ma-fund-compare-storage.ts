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

export function saveFundCompare(compare: SavedFundCompare) {
  if (typeof window === "undefined") return
  const existing = loadAllFundCompares()
  const next = [compare, ...existing.filter((c) => c.id !== compare.id)]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("ma-fund-compares-updated"))
}

export function deleteFundCompare(id: string) {
  if (typeof window === "undefined") return
  const next = loadAllFundCompares().filter((c) => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("ma-fund-compares-updated"))
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
