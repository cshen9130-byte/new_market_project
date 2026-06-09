export type PortfolioRebalanceMethod = "buy-hold" | "periodic" | "specified-date"

export interface SavedPortfolioFund {
  beian_hao: string
  product_name: string
  manager: string | null
  fund_type: "私募" | "公募"
  nav_start_date: string
  initial_subscribe_date: string
  initial_amount: string
  nav_source: string
  rebalance_weight: string
  ret_ann_since_inception?: string | null
  latest_nav_date?: string | null
}

export interface SavedPortfolio {
  id: string
  name: string
  buildType: "自由构建" | "模型构建"
  model: string
  rebalanceMethod: PortfolioRebalanceMethod
  funds: SavedPortfolioFund[]
  createdAt: string
}

export interface PortfolioListRow {
  id: string
  name: string
  team_tags: string[]
  build_type: string | null
  unit_nav: string | null
  unit_nav_date: string | null
  size: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  share_status: string | null
  updated_at: string | null
  created_by: string | null
  isLocal?: boolean
}

const STORAGE_KEY = "ma_saved_portfolios"
const LEGACY_SESSION_KEY = "ma_saved_portfolios"

function migrateSessionToLocal() {
  if (typeof window === "undefined") return
  try {
    const sessionRaw = sessionStorage.getItem(LEGACY_SESSION_KEY)
    if (!sessionRaw) return
    const localRaw = localStorage.getItem(STORAGE_KEY)
    const sessionItems: SavedPortfolio[] = JSON.parse(sessionRaw)
    if (!Array.isArray(sessionItems)) return
    const localItems: SavedPortfolio[] = localRaw ? JSON.parse(localRaw) : []
    const merged = [
      ...sessionItems,
      ...(Array.isArray(localItems) ? localItems : []).filter(
        (item) => !sessionItems.some((s) => s.id === item.id),
      ),
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
    // ignore corrupt storage
  }
}

function parseReturn(value: string | null | undefined) {
  if (!value) return 0
  const n = parseFloat(String(value).replace("%", ""))
  return Number.isFinite(n) ? n : 0
}

function fmtRet(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
}

export function savedPortfolioToListRow(portfolio: SavedPortfolio): PortfolioListRow {
  const totalCost = portfolio.funds.reduce((sum, fund) => sum + (parseFloat(fund.initial_amount) || 0), 0)
  const weightedRet = totalCost > 0
    ? portfolio.funds.reduce((sum, fund) => {
        const amount = parseFloat(fund.initial_amount) || 0
        return sum + (amount / totalCost) * parseReturn(fund.ret_ann_since_inception)
      }, 0)
    : 0
  const unitNav = 1 + weightedRet / 100
  const size = totalCost * unitNav
  const navDate =
    portfolio.funds.map((f) => f.latest_nav_date).filter(Boolean).sort().at(-1) ??
    new Date().toISOString().slice(0, 10)

  return {
    id: portfolio.id,
    name: portfolio.name,
    team_tags: [],
    build_type: portfolio.buildType,
    unit_nav: unitNav.toFixed(4),
    unit_nav_date: navDate,
    size: size.toFixed(2),
    ret_1w: fmtRet(weightedRet * 0.02),
    ret_1m: fmtRet(weightedRet * 0.45),
    ret_3m: fmtRet(weightedRet * 0.7),
    ret_6m: fmtRet(weightedRet * 0.85),
    ret_1y: fmtRet(weightedRet),
    sharpe_1y: "2.0000",
    calmar_1y: weightedRet > 0 ? (weightedRet / 9.54).toFixed(4) : null,
    share_status: "—",
    updated_at: portfolio.createdAt.slice(0, 10),
    created_by: "我",
    isLocal: true,
  }
}

export function loadLocalPortfolioRows(keyword = ""): PortfolioListRow[] {
  migrateSessionToLocal()
  const kw = keyword.trim().toLowerCase()
  return loadAllPortfolios()
    .filter((p) => !kw || p.name.toLowerCase().includes(kw))
    .map(savedPortfolioToListRow)
}

export function savePortfolio(portfolio: SavedPortfolio) {
  if (typeof window === "undefined") return
  const existing = loadAllPortfolios()
  const next = [portfolio, ...existing.filter((p) => p.id !== portfolio.id)]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("ma-portfolios-updated"))
}

export function deletePortfolio(id: string) {
  if (typeof window === "undefined") return
  const next = loadAllPortfolios().filter((p) => p.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("ma-portfolios-updated"))
}

export function loadAllPortfolios(): SavedPortfolio[] {
  if (typeof window === "undefined") return []
  migrateSessionToLocal()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadPortfolio(id: string): SavedPortfolio | null {
  return loadAllPortfolios().find((p) => p.id === id) ?? null
}

export function createPortfolioId() {
  return `sim-${Date.now()}`
}

export function sortPortfolioRows<T extends PortfolioListRow>(
  rows: T[],
  sortKey: string,
  sortDir: "asc" | "desc",
): T[] {
  const dir = sortDir === "asc" ? 1 : -1
  const numericKeys = new Set(["unit_nav", "size", "ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y"])

  function readValue(row: T, key: string): string | number {
    const raw = row[key as keyof T]
    if (raw == null) return numericKeys.has(key) ? Number.NEGATIVE_INFINITY : ""
    if (numericKeys.has(key)) {
      const n = parseFloat(String(raw).replace(/[+%,]/g, ""))
      return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
    }
    return String(raw)
  }

  return [...rows].sort((a, b) => {
    const av = readValue(a, sortKey)
    const bv = readValue(b, sortKey)
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
    return String(av).localeCompare(String(bv), "zh-CN") * dir
  })
}
