import { publicQuery } from "@/lib/db"
import { productNameFromClientLabel } from "@/lib/server/account-risk-product-elements"
import {
  aggregateEquityByDate,
  compoundAccountRiskNav,
  type AccountRiskNavPoint,
} from "@/lib/server/account-risk-nav"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"
import {
  handleAccountRiskExport,
  streamAccountRiskSheetCsv,
  isAccountRiskBinary,
  type AccountRiskBinaryResult,
} from "@/lib/server/account-risk-data-export"

export { isAccountRiskBinary }

/**
 * Read-only view of the 单账户监控中心 import.
 * Queries public.cfmmc_* only. Does not read or write public.mom_*.
 */

const ACCOUNT_OK = `
  COALESCE(TRIM(account_no::text), '') <> ''
  AND UPPER(TRIM(account_no::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM(account_no::text)) NOT LIKE '%GUOSEN%'
  AND TRIM(account_no::text) NOT LIKE '%国信%'
  AND TRIM(account_no::text) <> '665300200077'
`

const DAILY_COLS = [
  "account_no", "client_name", "company_name", "source_file",
  "balance_bf", "client_equity", "deposit_wd", "available_actual",
  "realized_pl", "mtm_pl", "commission", "balance_cf", "margin_occupied",
  "daily_pnl", "available", "risk_ratio", "margin_call",
]
const PRODUCT_COLS = ["account_no", "source_file", "row_num", "product_code", "volume", "turnover", "commission", "realized_pl"]
const POSITION_COLS = [
  "account_no", "source_file", "row_num", "instrument", "trade_no", "bs",
  "open_price", "lots", "latest_price", "settl_price", "floating_pl", "sh",
  "buy_lots", "buy_price", "sell_lots", "sell_price", "prev_settle",
  "trade_code", "actual_date", "notional_mv", "allocated_margin",
]
const TRADE_COLS = [
  "account_no", "source_file", "row_num", "instrument", "trade_no", "trade_time",
  "bs", "sh", "price", "lots", "turnover", "oc", "commission", "realized_pl", "actual_date",
]
const CLOSE_COLS = [
  "account_no", "source_file", "row_num", "instrument", "trade_no", "bs",
  "price", "open_price", "lots", "prev_settle", "realized_pl", "orig_trade_no", "actual_date",
]
const CASH_COLS = ["account_no", "source_file", "row_num", "occur_date", "deposit", "withdrawal", "method", "memo"]
const OPTION_COLS = [
  "account_no", "source_file", "row_num", "instrument", "trade_no", "trade_time",
  "bs", "premium_px", "volume", "premium", "covered", "commission", "actual_date",
]
const SECURITY_COLS = [
  "account_no", "source_file", "row_num", "code", "name", "change_type", "bs",
  "trade_no", "trade_time", "price", "qty", "amount", "commission",
]

type Sheet = {
  table: string
  cols: string[]
  defaultLimit: number
  defaultDesc: boolean
  snapshot: boolean
}

const SHEETS: Record<string, Sheet> = {
  daily: { table: "cfmmc_daily_summary", cols: DAILY_COLS, defaultLimit: 500, defaultDesc: false, snapshot: false },
  products: { table: "cfmmc_product_pnl", cols: PRODUCT_COLS, defaultLimit: 500, defaultDesc: false, snapshot: false },
  positions: { table: "cfmmc_positions", cols: POSITION_COLS, defaultLimit: 500, defaultDesc: false, snapshot: true },
  trades: { table: "cfmmc_trades", cols: TRADE_COLS, defaultLimit: 200, defaultDesc: true, snapshot: false },
  closes: { table: "cfmmc_closes", cols: CLOSE_COLS, defaultLimit: 200, defaultDesc: true, snapshot: false },
  cashflows: { table: "cfmmc_cash_flows", cols: CASH_COLS, defaultLimit: 200, defaultDesc: false, snapshot: false },
  "option-trades": { table: "cfmmc_option_trades", cols: OPTION_COLS, defaultLimit: 200, defaultDesc: true, snapshot: false },
  securities: { table: "cfmmc_securities", cols: SECURITY_COLS, defaultLimit: 200, defaultDesc: true, snapshot: false },
}

function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function accountCode(value: string | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text || text.length > 64) return null
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  return text
}

function pageArgs(record: Record<string, string | undefined>, fallbackLimit: number, defaultDesc: boolean) {
  const limitRaw = Number.parseInt(record.limit ?? "", 10)
  const offsetRaw = Number.parseInt(record.offset ?? "", 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(2000, Math.max(1, limitRaw)) : fallbackLimit
  const offset = Number.isFinite(offsetRaw) ? Math.min(10_000_000, Math.max(0, offsetRaw)) : 0
  const order = record.order === "0" || (record.order == null && defaultDesc) ? "DESC" : "ASC"
  return { limit, offset, order }
}

function isMissingRelation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  const msg = err instanceof Error ? err.message : String(err)
  return code === "42P01" || msg.includes("does not exist")
}

async function q<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await publicQuery(sql, params)
  return res.rows as T[]
}

function selectCols(cols: string[]): string {
  return ["trade_date::text AS trade_date", ...cols].join(", ")
}

/** Same shortening as 单账户总览的「期货公司」列. */
function shortCompanyName(raw: string): string {
  return raw
    .replace(/股份有限公司$/, "")
    .replace(/有限责任公司$/, "")
    .replace(/有限公司$/, "")
    .trim()
}

function labelMatches(query: string, labels: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "")
  if (!q) return true
  return labels.some((label) => {
    const text = String(label ?? "").trim().toLowerCase().replace(/\s+/g, "")
    return text.length >= 2 && (text.includes(q) || q.includes(text))
  })
}

/** Broker or product name used to confirm a 资金账号. Digits-only q is not a company. */
function companyQuery(record: Record<string, string | undefined>): string {
  const company = (record.company ?? "").trim()
  if (company) return company
  const q = (record.q ?? "").trim()
  if (!q || q === (record.account ?? "").trim()) return ""
  if (/^[A-Za-z0-9_-]+$/.test(q)) return ""
  return q
}

const NAV_FORMULA =
  "复权净值从 1 起复利，与单账户总览净值曲线相同。日收益率 = (当日客户权益 - 上日客户权益 - 出入金) / 上日客户权益。出入金含当日存取合计，以及结算单未记入存取、但改变了结存的大额整数划转。不使用平仓盈亏加浮动盈亏。"

function navRow(point: AccountRiskNavPoint) {
  return {
    date: point.date,
    nav: point.nav,
    daily_return: point.dailyReturn,
    pnl: point.pnl,
    cum_pnl: point.cumPnl,
    equity: point.cumCapital,
    net_flow: point.netFlow,
  }
}

function catalog() {
  return momDataOk({
    name: "account-risk-data",
    source: "public.cfmmc_* written by the 单账户监控中心 / 国投结算导入",
    auth: "Same MOM API key (prefix mk_). The fund-data key is rejected.",
    endpoints: [
      { method: "GET", path: "/accounts", description: "已导入的单账户列表。q 可填期货公司、产品名或资金账号，例如 国泰君安期货" },
      { method: "GET", path: "/account/nav", description: "复权净值，与单账户总览净值曲线相同。例如 account=85121150&company=国泰君安期货" },
      { method: "GET", path: "/account/daily", description: "cfmmc_daily_summary 每日结算摘要。传 start_date 与 end_date 取历史区间" },
      { method: "GET", path: "/account/products", description: "cfmmc_product_pnl 品种盈亏。传 start_date 与 end_date 取每个交易日" },
      { method: "GET", path: "/account/positions", description: "历史逐日持仓。传 start_date 与 end_date 返回区间内每个交易日的持仓明细，用来还原建仓、加仓、减仓、换月。不传日期时只返回最近一个交易日，响应 history 给出库内首尾日期" },
      { method: "GET", path: "/account/trades", description: "历史成交明细，含开/平、成交时间、实际成交日期。传 start_date 与 end_date，默认最近的在前" },
      { method: "GET", path: "/account/closes", description: "历史平仓明细，含开仓价、平仓价、原成交序号。传 start_date 与 end_date" },
      { method: "GET", path: "/account/cashflows", description: "cfmmc_cash_flows 出入金" },
      { method: "GET", path: "/account/option-trades", description: "cfmmc_option_trades 期权成交" },
      { method: "GET", path: "/account/securities", description: "cfmmc_securities 证券成交" },
      { method: "GET", path: "/account/export", description: "一次性导出该资金账号全部入库数据（含历史逐日持仓）为 CSV；默认 zip。参数 account、可选 company、datasets、start_date、end_date、format=zip|dir|csv" },
    ],
  })
}

async function listAccounts(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const keyword = (record.q ?? record.company ?? "").trim()
  const { limit, offset } = pageArgs(record, 500, false)
  const params: unknown[] = []
  let keywordSql = ""
  if (keyword) {
    params.push(`%${keyword}%`)
    keywordSql = `AND (
      l.account_no ILIKE $1
      OR COALESCE(l.client_name, '') ILIKE $1
      OR COALESCE(l.company_name, '') ILIKE $1
    )`
  }
  const sql = `
    WITH span AS (
      SELECT account_no,
             MIN(trade_date)::text AS first_date,
             MAX(trade_date)::text AS last_date,
             COUNT(*)::int AS trading_days
        FROM public.cfmmc_daily_summary
       WHERE ${ACCOUNT_OK}
       GROUP BY account_no
    ),
    latest AS (
      SELECT DISTINCT ON (account_no)
             account_no,
             trade_date::text AS trade_date,
             client_name,
             company_name,
             client_equity,
             margin_occupied,
             available,
             daily_pnl,
             risk_ratio,
             deposit_wd
        FROM public.cfmmc_daily_summary
       WHERE ${ACCOUNT_OK}
       ORDER BY account_no, trade_date DESC
    )
    SELECT l.account_no,
           l.trade_date,
           l.client_name,
           l.company_name,
           l.client_equity,
           l.margin_occupied,
           l.available,
           l.daily_pnl,
           l.risk_ratio,
           l.deposit_wd,
           s.first_date,
           s.last_date,
           s.trading_days
      FROM latest l
      JOIN span s ON s.account_no = l.account_no
     WHERE TRUE ${keywordSql}
     ORDER BY l.account_no
  `
  const rows = await q<Record<string, unknown>>(sql, params)
  const accounts = rows.map((row) => {
    const clientName = String(row.client_name ?? "").trim()
    const companyRaw = String(row.company_name ?? "").trim()
    return {
      account: String(row.account_no ?? "").trim(),
      account_no: String(row.account_no ?? "").trim(),
      fund_name: productNameFromClientLabel(clientName) || null,
      client_name: clientName || null,
      company: shortCompanyName(companyRaw) || null,
      company_name: companyRaw || null,
      first_date: row.first_date ?? null,
      last_date: row.last_date ?? null,
      trading_days: row.trading_days ?? null,
      trade_date: row.trade_date ?? null,
      client_equity: row.client_equity ?? null,
      margin_occupied: row.margin_occupied ?? null,
      available: row.available ?? null,
      daily_pnl: row.daily_pnl ?? null,
      risk_ratio: row.risk_ratio ?? null,
      deposit_wd: row.deposit_wd ?? null,
    }
  })
  const slice = accounts.slice(offset, offset + limit)
  return momDataOk({
    accounts: slice,
    total: accounts.length,
    limit,
    offset,
    next_offset: offset + slice.length < accounts.length ? offset + slice.length : null,
  })
}

const POSITION_HISTORY_NOTE =
  "默认只返回最近一个交易日。已导入的每个交易日持仓都在库里。逐日持仓请在本接口传 start_date 和 end_date；单日用 date。成交明细是 /account/trades，平仓明细是 /account/closes，同样支持起止日期，用来还原建仓、加仓、减仓、换月。翻页看 total 和 next_offset。"

async function positionHistorySpan(account: string): Promise<{
  first_date: string | null
  last_date: string | null
  trading_days: number
}> {
  const rows = await q<{ first_date: string | null; last_date: string | null; trading_days: number | string }>(
    `SELECT MIN(trade_date)::text AS first_date,
            MAX(trade_date)::text AS last_date,
            COUNT(DISTINCT trade_date)::int AS trading_days
       FROM public.cfmmc_positions
      WHERE account_no = $1 AND ${ACCOUNT_OK}`,
    [account],
  )
  const row = rows[0]
  const days = Number(row?.trading_days ?? 0)
  return {
    first_date: row?.first_date ? String(row.first_date).slice(0, 10) : null,
    last_date: row?.last_date ? String(row.last_date).slice(0, 10) : null,
    trading_days: Number.isFinite(days) ? days : 0,
  }
}

async function accountExists(account: string): Promise<boolean> {
  const rows = await q<{ ok: number }>(
    `SELECT 1 AS ok FROM public.cfmmc_daily_summary WHERE account_no = $1 AND ${ACCOUNT_OK} LIMIT 1`,
    [account],
  )
  return rows.length > 0
}

async function readSheet(
  sheet: Sheet,
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown>> {
  const account = accountCode(record.account)
  if (!account) return momDataErr(1, "account is required")
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  const date = record.date ? isoDate(record.date) : null
  if (record.start_date && !start) return momDataErr(1, "start_date must be YYYY-MM-DD")
  if (record.end_date && !end) return momDataErr(1, "end_date must be YYYY-MM-DD")
  if (record.date && !date) return momDataErr(1, "date must be YYYY-MM-DD")
  if (start && end && start > end) return momDataErr(1, "start_date must be on or before end_date")
  if (!(await accountExists(account))) return momDataErr(2, "account not found")

  const { limit, offset, order } = pageArgs(record, sheet.defaultLimit, sheet.defaultDesc)
  const params: unknown[] = [account]
  const filters = [`account_no = $1`, ACCOUNT_OK]
  let snapshotDate = date
  if (sheet.snapshot && !date && !start && !end) {
    const latest = await q<{ d: string | null }>(
      `SELECT MAX(trade_date)::text AS d FROM public.${sheet.table} WHERE account_no = $1 AND ${ACCOUNT_OK}`,
      [account],
    )
    snapshotDate = latest[0]?.d ? String(latest[0].d).slice(0, 10) : null
    if (!snapshotDate) {
      return momDataOk({ account, date: null, rows: [], total: 0, limit, offset, next_offset: null })
    }
  }
  if (snapshotDate) {
    params.push(snapshotDate)
    filters.push(`trade_date = $${params.length}::date`)
  }
  if (start) {
    params.push(start)
    filters.push(`trade_date >= $${params.length}::date`)
  }
  if (end) {
    params.push(end)
    filters.push(`trade_date <= $${params.length}::date`)
  }
  const where = filters.join(" AND ")
  const countRows = await q<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM public.${sheet.table} WHERE ${where}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)
  params.push(limit, offset)
  const orderBy = sheet.cols.includes("row_num") ? `trade_date ${order}, row_num ASC` : `trade_date ${order}`
  const rows = await q<Record<string, unknown>>(
    `SELECT ${selectCols(sheet.cols)}
       FROM public.${sheet.table}
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  const page = {
    account,
    date: snapshotDate,
    rows,
    total,
    limit,
    offset,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
  }
  if (sheet.snapshot && !start && !end) {
    const span = await positionHistorySpan(account)
    return momDataOk({
      ...page,
      snapshot: true,
      history: {
        ...span,
        note: POSITION_HISTORY_NOTE,
      },
    })
  }
  return momDataOk(page)
}

async function readNav(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = accountCode(record.account)
  if (!account) return momDataErr(1, "account is required")
  const companyQ = companyQuery(record)
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  if (record.start_date && !start) return momDataErr(1, "start_date must be YYYY-MM-DD")
  if (record.end_date && !end) return momDataErr(1, "end_date must be YYYY-MM-DD")
  if (start && end && start > end) return momDataErr(1, "start_date must be on or before end_date")
  if (!(await accountExists(account))) return momDataErr(2, "account not found")

  const identity = await q<{ client_name: string | null; company_name: string | null }>(
    `SELECT client_name, company_name
       FROM public.cfmmc_daily_summary
      WHERE account_no = $1 AND ${ACCOUNT_OK}
      ORDER BY trade_date DESC
      LIMIT 1`,
    [account],
  )
  const clientName = String(identity[0]?.client_name ?? "").trim()
  const companyRaw = String(identity[0]?.company_name ?? "").trim()
  const company = shortCompanyName(companyRaw)
  const fundName = productNameFromClientLabel(clientName)
  if (companyQ && !labelMatches(companyQ, [company, companyRaw, clientName, fundName])) {
    return momDataErr(2, "account does not match company")
  }

  const params: unknown[] = [account]
  let endSql = ""
  if (end) {
    params.push(end)
    endSql = ` AND trade_date <= $${params.length}::date`
  }
  const rows = await q<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
    balance_bf: unknown
    balance_cf: unknown
    realized_pl: unknown
    commission: unknown
  }>(
    `SELECT trade_date::text AS date,
            client_equity, daily_pnl, deposit_wd,
            balance_bf, balance_cf, realized_pl, commission
       FROM public.cfmmc_daily_summary
      WHERE account_no = $1 AND ${ACCOUNT_OK}${endSql}
      ORDER BY trade_date ASC`,
    params,
  )
  const series = compoundAccountRiskNav(aggregateEquityByDate(rows))
  const visible = start ? series.filter((point) => point.date >= start) : series
  const { limit, offset, order } = pageArgs(record, 2000, false)
  const ordered = order === "DESC" ? [...visible].reverse() : visible
  const page = ordered.slice(offset, offset + limit)
  const latest = visible.length > 0 ? visible[visible.length - 1] : null
  return momDataOk({
    account,
    fund_name: fundName || null,
    company_name: company || null,
    company_name_raw: companyRaw || null,
    client_name: clientName || null,
    inception_date: series[0]?.date ?? null,
    last_date: series.length > 0 ? series[series.length - 1].date : null,
    trading_days: visible.length,
    formula: NAV_FORMULA,
    latest: latest ? navRow(latest) : null,
    rows: page.map(navRow),
    total: visible.length,
    limit,
    offset,
    next_offset: offset + page.length < ordered.length ? offset + page.length : null,
  })
}

export async function handleAccountRiskDataRequest(
  path: string,
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown> | AccountRiskBinaryResult> {
  const key = path.replace(/^\/+|\/+$/g, "")
  try {
    if (key === "" || key === "meta") return catalog()
    if (key === "accounts") return await listAccounts(record)
    if (key === "account/nav") return await readNav(record)
    if (key === "account/export") return await handleAccountRiskExport(record)
    if (key.startsWith("account/")) {
      const sheetKey = key.slice("account/".length)
      const sheet = SHEETS[sheetKey]
      if (!sheet) return momDataErr(1, `unknown path: /${key}`)
      const format = (record.format ?? "").trim().toLowerCase()
      if (format === "csv") return await streamAccountRiskSheetCsv(sheetKey, record)
      return await readSheet(sheet, record)
    }
    return momDataErr(1, `unknown path: /${key}`)
  } catch (err) {
    if (isMissingRelation(err)) return momDataErr(2, "single-account settlement data is not loaded")
    throw err
  }
}