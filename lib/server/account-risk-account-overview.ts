/**
 * Latest per-account snapshot for 单账户总览 (全部账户汇总).
 * Reads public.cfmmc_* only.
 */
import { publicQuery } from "@/lib/db"
import { toNum } from "@/lib/server/account-risk-classify"
import {
  aggregateEquityByDate,
  compoundAccountRiskNav,
  countedEquityPathPnl,
} from "@/lib/server/account-risk-nav"
import { accountNoMatchesUserId, listImportBooks, type ImportBook } from "@/lib/server/account-risk-books"
import { productNameFromClientLabel } from "@/lib/server/account-risk-product-elements"
import { pmForAccount } from "@/lib/server/account-risk-pm"
import { scopeWhere } from "@/lib/server/account-risk-scope"

export type AccountOverviewRow = {
  fundName: string
  companyName: string
  accountNo: string
  /** PM abbreviation from the 单账户对应表. Empty when that account is not listed. */
  pm: string
  /** Switcher value (`book:…` or the 资金账号) so the overview can open this account. */
  selectKey: string
  tradeDate: string
  equity: number | null
  margin: number | null
  totalPl: number | null
  holdingPl: number | null
  closedPl: number | null
  riskPct: number | null
  unilateralRiskPct: number | null
  commission: number | null
  /** Compounded unit NAV (starts at 1), same formula as the 净值曲线 chart. */
  nav: number[]
}

function clean(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  if (!s || s === "—" || s === "-") return ""
  return s
}

function shortCompanyName(raw: string): string {
  return raw
    .replace(/股份有限公司$/, "")
    .replace(/有限责任公司$/, "")
    .replace(/有限公司$/, "")
    .trim()
}

function asRiskPct(raw: number | null, margin: number, equity: number): number | null {
  if (raw != null) return raw <= 1 ? raw * 100 : raw
  return equity > 0 ? (margin / equity) * 100 : null
}

/**
 * Some 国投结算单 store 保证金占用 as 0 while 客户权益, 可用资金 and 风险度
 * still describe the real occupation (margin = equity − available).
 */
function reconcileMargin(
  margin: number | null,
  equity: number | null,
  available: number | null,
  riskRaw: number | null,
): number | null {
  if (margin != null && margin !== 0) return margin
  if (equity == null || equity <= 0 || available == null || available < 0 || available >= equity) return margin
  if (riskRaw == null || riskRaw <= 0) return margin
  const riskFrac = riskRaw <= 1 ? riskRaw : riskRaw / 100
  const implied = equity - available
  if (Math.abs(implied / equity - riskFrac) > 0.005) return margin
  return Math.round(implied * 100) / 100
}

function asUnilateralPct(longMargin: number, shortMargin: number, margin: number, equity: number): number | null {
  if (equity <= 0) return null
  const lsTotal = longMargin + shortMargin
  if (lsTotal > 0) return (Math.abs(longMargin - shortMargin) / equity) * 100
  if (margin > 0) return null
  return 0
}

const SPARKLINE_POINTS = 96

/** Keep endpoints so the cell still shows the true start and latest NAV. */
function downsampleNav(values: number[], maxPoints = SPARKLINE_POINTS): number[] {
  if (values.length <= maxPoints) return values
  const last = values.length - 1
  const out: number[] = []
  for (let i = 0; i < maxPoints; i++) {
    out.push(values[Math.round((i * last) / (maxPoints - 1))])
  }
  return out
}

async function loadNavSeriesByAccount(): Promise<Map<string, number[]>> {
  const params: unknown[] = []
  const scoped = scopeWhere(params)
  const result = await publicQuery(
    `
    SELECT account_no,
           trade_date::text AS date,
           COALESCE(client_equity, 0) AS client_equity,
           COALESCE(daily_pnl, 0) AS daily_pnl,
           COALESCE(deposit_wd, 0) AS deposit_wd,
           balance_bf,
           balance_cf,
           realized_pl,
           commission
    FROM public.cfmmc_daily_summary
    WHERE ${scoped}
    ORDER BY account_no ASC, trade_date ASC
    `,
    params,
  )
  const byAccount = new Map<string, Array<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
    balance_bf: unknown
    balance_cf: unknown
    realized_pl: unknown
    commission: unknown
  }>>()
  for (const row of result.rows as Array<{
    account_no: string
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
    balance_bf: unknown
    balance_cf: unknown
    realized_pl: unknown
    commission: unknown
  }>) {
    const account = String(row.account_no ?? "").trim()
    if (!account) continue
    const list = byAccount.get(account)
    const point = {
      date: row.date,
      client_equity: row.client_equity,
      daily_pnl: row.daily_pnl,
      deposit_wd: row.deposit_wd,
      balance_bf: row.balance_bf,
      balance_cf: row.balance_cf,
      realized_pl: row.realized_pl,
      commission: row.commission,
    }
    if (list) list.push(point)
    else byAccount.set(account, [point])
  }
  const out = new Map<string, number[]>()
  for (const [account, days] of byAccount) {
    const series = compoundAccountRiskNav(aggregateEquityByDate(days))
    out.set(account, downsampleNav(series.map((point) => point.nav)))
  }
  return out
}

/** Map a 资金账号 to the account switcher value. Prefer the import book that owns the file. */
function bookSelectKey(accountNo: string, sourceFile: string, books: ImportBook[]): string {
  const rel = sourceFile.replace(/\\/g, "/").trim()
  const active = books.filter((book) => book.files.length > 0)
  if (rel) {
    const exact = active.find((book) => book.files.some((file) => file.replace(/\\/g, "/") === rel))
    if (exact) return `book:${exact.id}`
    const prefix = rel.includes("/") ? rel.split("/")[0] : ""
    if (prefix) {
      const byDir = active.find((book) => book.id === prefix)
      if (byDir) return `book:${byDir.id}`
    }
  }
  const byUser = active.find((book) => book.cfmmcUserId && accountNoMatchesUserId(accountNo, book.cfmmcUserId))
  return byUser ? `book:${byUser.id}` : accountNo
}

export type AccountOverviewGroup = "none" | "fund" | "company" | "pm"

export type AccountOverviewApiRow = {
  fund_name: string
  company: string
  account: string
  pm: string
  trade_date: string | null
  account_count: number
  nav: number[]
  latest_nav: number | null
  nav_return_pct: number | null
  equity: number | null
  margin: number | null
  daily_pnl: number | null
  holding_pnl: number | null
  closed_pnl: number | null
  risk_pct: number | null
  unilateral_risk_pct: number | null
  commission: number | null
}

function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

function sumOf(rows: AccountOverviewRow[], key: "equity" | "margin" | "totalPl" | "holdingPl" | "closedPl" | "commission"): number | null {
  let total = 0
  let any = false
  for (const row of rows) {
    const value = row[key]
    if (value == null || !Number.isFinite(value)) continue
    total += value
    any = true
  }
  return any ? total : null
}

function equityWeightedPct(rows: AccountOverviewRow[]): number | null {
  let weight = 0
  let weighted = 0
  for (const row of rows) {
    if (row.equity == null || row.equity <= 0 || row.unilateralRiskPct == null) continue
    weight += row.equity
    weighted += row.unilateralRiskPct * row.equity
  }
  return weight > 0 ? weighted / weight : null
}

function riskFromSums(margin: number | null, equity: number | null): number | null {
  if (margin == null || equity == null || equity <= 0) return null
  return (margin / equity) * 100
}

function navReturnPct(nav: number[]): number | null {
  if (nav.length < 2) return null
  const first = nav[0]
  const last = nav[nav.length - 1]
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(last)) return null
  return (last / first - 1) * 100
}

function labelMany(names: string[], unit: string): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (unique.length === 0) return ""
  if (unique.length === 1) return unique[0]
  return `${unique[0]}等${unique.length}${unit}`
}

function matchesQuery(row: AccountOverviewRow, q: string): boolean {
  if (!q) return true
  const hay = [row.fundName, row.companyName, row.accountNo, row.pm].join(" ").toLowerCase().replace(/\s+/g, "")
  return hay.includes(q)
}

function latestTradeDate(members: AccountOverviewRow[]): string | null {
  let max = ""
  for (const row of members) {
    if (row.tradeDate > max) max = row.tradeDate
  }
  return max || null
}

function toApiRow(members: AccountOverviewRow[], group: AccountOverviewGroup, key: string): AccountOverviewApiRow {
  const equity = sumOf(members, "equity")
  const margin = sumOf(members, "margin")
  const single = group === "none" && members.length === 1 ? members[0] : null
  const nav = single?.nav ?? []
  return {
    fund_name: group === "company" || group === "pm"
      ? labelMany(members.map((row) => row.fundName), "个")
      : (single ? single.fundName : key),
    company: group === "fund" || group === "pm"
      ? labelMany(members.map((row) => row.companyName), "家")
      : (single ? single.companyName : key),
    account: single ? single.accountNo : `${members.length}个账号`,
    pm: group === "pm" ? key : (single ? single.pm : labelMany(members.map((row) => row.pm), "人")),
    trade_date: latestTradeDate(members),
    account_count: members.length,
    nav,
    latest_nav: nav.length ? round2(nav[nav.length - 1]) : null,
    nav_return_pct: round2(navReturnPct(nav)),
    equity: round2(equity),
    margin: round2(margin),
    daily_pnl: round2(sumOf(members, "totalPl")),
    holding_pnl: round2(sumOf(members, "holdingPl")),
    closed_pnl: round2(sumOf(members, "closedPl")),
    risk_pct: round2(single ? single.riskPct : riskFromSums(margin, equity)),
    unilateral_risk_pct: round2(single ? single.unilateralRiskPct : equityWeightedPct(members)),
    commission: round2(sumOf(members, "commission")),
  }
}

/** Same columns and 合计 rules as 单账户总览. `q` matches 产品、期货公司、账号、PM. */
export function shapeAccountOverviewTable(
  rows: AccountOverviewRow[],
  options: { q?: string; group?: AccountOverviewGroup } = {},
): { as_of: string | null; rows: AccountOverviewApiRow[]; total: {
  account_count: number
  equity: number | null
  margin: number | null
  daily_pnl: number | null
  holding_pnl: number | null
  closed_pnl: number | null
  commission: number | null
  risk_pct: number | null
  unilateral_risk_pct: number | null
} } {
  const q = (options.q ?? "").trim().toLowerCase().replace(/\s+/g, "")
  const group = options.group ?? "none"
  const filtered = rows.filter((row) => matchesQuery(row, q))
  let apiRows: AccountOverviewApiRow[]
  if (group === "none") {
    apiRows = filtered.map((row, index) => toApiRow([row], "none", row.accountNo || `${row.fundName}-${index}`))
  } else {
    const groups = new Map<string, AccountOverviewRow[]>()
    for (const row of filtered) {
      const raw = group === "fund" ? row.fundName : group === "company" ? row.companyName : row.pm
      const key = (raw || "").trim() || "—"
      const list = groups.get(key)
      if (list) list.push(row)
      else groups.set(key, [row])
    }
    apiRows = [...groups.entries()].map(([key, members]) => toApiRow(members, group, key))
  }
  const asOf = filtered.reduce((max, row) => (row.tradeDate > max ? row.tradeDate : max), "")
  const equity = sumOf(filtered, "equity")
  const margin = sumOf(filtered, "margin")
  return {
    as_of: asOf || null,
    rows: apiRows,
    total: {
      account_count: filtered.length,
      equity: round2(equity),
      margin: round2(margin),
      daily_pnl: round2(sumOf(filtered, "totalPl")),
      holding_pnl: round2(sumOf(filtered, "holdingPl")),
      closed_pnl: round2(sumOf(filtered, "closedPl")),
      commission: round2(sumOf(filtered, "commission")),
      risk_pct: round2(riskFromSums(margin, equity)),
      unilateral_risk_pct: round2(equityWeightedPct(filtered)),
    },
  }
}

export async function loadAccountOverviewRows(): Promise<AccountOverviewRow[]> {
  const [rows, navByAccount] = await Promise.all([
    loadAccountOverviewSnapshots(),
    loadNavSeriesByAccount(),
  ])
  const books = listImportBooks()
  return rows.map((row) => {
    const { sourceFile, ...rest } = row
    return {
      ...rest,
      selectKey: bookSelectKey(row.accountNo, sourceFile, books),
      nav: navByAccount.get(row.accountNo) ?? [],
      pm: pmForAccount(row.accountNo),
    }
  })
}

async function loadAccountOverviewSnapshots(): Promise<Array<Omit<AccountOverviewRow, "nav" | "selectKey" | "pm"> & { sourceFile: string }>> {
  const params: unknown[] = []
  const scoped = scopeWhere(params)
  const result = await publicQuery(
    `
    WITH ranked AS (
      SELECT
        account_no,
        trade_date,
        source_file,
        client_name,
        company_name,
        client_equity,
        margin_occupied,
        available,
        deposit_wd,
        realized_pl,
        commission,
        risk_ratio,
        LAG(client_equity) OVER (PARTITION BY account_no ORDER BY trade_date) AS prev_equity
      FROM public.cfmmc_daily_summary
      WHERE ${scoped}
    ),
    latest AS (
      SELECT DISTINCT ON (account_no)
        account_no,
        trade_date,
        source_file,
        client_name,
        company_name,
        client_equity,
        margin_occupied,
        available,
        deposit_wd,
        realized_pl,
        commission,
        risk_ratio,
        prev_equity
      FROM ranked
      ORDER BY account_no, trade_date DESC
    ),
    ls AS (
      SELECT p.account_no,
             SUM(CASE WHEN COALESCE(p.buy_lots, 0) > 0 OR p.bs = '买'
                      THEN COALESCE(p.allocated_margin, 0) ELSE 0 END) AS long_margin,
             SUM(CASE WHEN COALESCE(p.sell_lots, 0) > 0 OR p.bs = '卖'
                      THEN COALESCE(p.allocated_margin, 0) ELSE 0 END) AS short_margin
      FROM public.cfmmc_positions p
      INNER JOIN latest l
        ON l.account_no = p.account_no AND p.trade_date = l.trade_date
      GROUP BY p.account_no
    )
    SELECT l.account_no,
           l.trade_date::text AS trade_date,
           l.source_file,
           l.client_name,
           l.company_name,
           l.client_equity,
           l.margin_occupied,
           l.available,
           l.deposit_wd,
           l.prev_equity,
           l.realized_pl,
           l.commission,
           l.risk_ratio,
           ls.long_margin,
           ls.short_margin
    FROM latest l
    LEFT JOIN ls ON ls.account_no = l.account_no
    ORDER BY COALESCE(l.client_equity, 0) DESC, l.account_no ASC
    `,
    params,
  )

  return (result.rows as {
    account_no: string
    trade_date: string
    source_file: string | null
    client_name: string | null
    company_name: string | null
    client_equity: number | string | null
    margin_occupied: number | string | null
    available: number | string | null
    deposit_wd: number | string | null
    prev_equity: number | string | null
    realized_pl: number | string | null
    commission: number | string | null
    risk_ratio: number | string | null
    long_margin: number | string | null
    short_margin: number | string | null
  }[]).map((row) => {
    const equity = row.client_equity == null ? null : toNum(row.client_equity)
    const riskRaw = row.risk_ratio == null ? null : toNum(row.risk_ratio)
    const available = row.available == null ? null : toNum(row.available)
    const margin = reconcileMargin(
      row.margin_occupied == null ? null : toNum(row.margin_occupied),
      equity,
      available,
      riskRaw,
    )
    const closedPl = row.realized_pl == null ? null : Math.round(toNum(row.realized_pl))
    const prevEquity = row.prev_equity == null ? null : toNum(row.prev_equity)
    const flow = toNum(row.deposit_wd)
    const totalPl = equity == null ? null : Math.round(countedEquityPathPnl(equity, prevEquity, flow))
    // Statement 浮动盈亏 is a mark-to-open LEVEL. Show today's increment so
    // 浮动盈亏 + 平仓盈亏 = 当日盈亏 (fees and other residuals sit in 浮动).
    const holdingPl = totalPl == null ? null : totalPl - (closedPl ?? 0)
    return {
      fundName: productNameFromClientLabel(clean(row.client_name)),
      companyName: shortCompanyName(clean(row.company_name)),
      accountNo: String(row.account_no ?? "").trim(),
      sourceFile: String(row.source_file ?? "").trim(),
      tradeDate: row.trade_date,
      equity,
      margin,
      totalPl,
      holdingPl,
      closedPl,
      riskPct: asRiskPct(riskRaw, margin ?? 0, equity ?? 0),
      unilateralRiskPct: asUnilateralPct(
        toNum(row.long_margin),
        toNum(row.short_margin),
        margin ?? 0,
        equity ?? 0,
      ),
      commission: row.commission == null ? null : toNum(row.commission),
    }
  })
}
