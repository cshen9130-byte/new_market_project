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
import { scopeWhere } from "@/lib/server/account-risk-scope"

export type AccountOverviewRow = {
  fundName: string
  companyName: string
  accountNo: string
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
           COALESCE(deposit_wd, 0) AS deposit_wd
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
  }>>()
  for (const row of result.rows as Array<{
    account_no: string
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
  }>) {
    const account = String(row.account_no ?? "").trim()
    if (!account) continue
    const list = byAccount.get(account)
    const point = {
      date: row.date,
      client_equity: row.client_equity,
      daily_pnl: row.daily_pnl,
      deposit_wd: row.deposit_wd,
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
    }
  })
}

async function loadAccountOverviewSnapshots(): Promise<Array<Omit<AccountOverviewRow, "nav" | "selectKey"> & { sourceFile: string }>> {
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
