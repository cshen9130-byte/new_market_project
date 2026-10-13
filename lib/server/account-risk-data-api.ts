import { publicQuery } from "@/lib/db"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"

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
  const offset = Number.isFinite(offsetRaw) ? Math.min(200_000, Math.max(0, offsetRaw)) : 0
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

function catalog() {
  return momDataOk({
    name: "account-risk-data",
    source: "public.cfmmc_* written by the 单账户监控中心 / 国投结算导入",
    auth: "Same MOM API key (prefix mk_). The fund-data key is rejected.",
    endpoints: [
      { method: "GET", path: "/accounts", description: "已导入的单账户列表，含最新权益、保证金和风险度" },
      { method: "GET", path: "/account/daily", description: "cfmmc_daily_summary 每日结算摘要" },
      { method: "GET", path: "/account/products", description: "cfmmc_product_pnl 品种盈亏" },
      { method: "GET", path: "/account/positions", description: "cfmmc_positions 持仓，默认最近一个交易日" },
      { method: "GET", path: "/account/trades", description: "cfmmc_trades 成交明细" },
      { method: "GET", path: "/account/closes", description: "cfmmc_closes 平仓明细" },
      { method: "GET", path: "/account/cashflows", description: "cfmmc_cash_flows 出入金" },
      { method: "GET", path: "/account/option-trades", description: "cfmmc_option_trades 期权成交" },
      { method: "GET", path: "/account/securities", description: "cfmmc_securities 证券成交" },
    ],
  })
}

async function listAccounts(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const keyword = (record.q ?? "").trim()
  const { limit, offset } = pageArgs(record, 500, false)
  const params: unknown[] = []
  let keywordSql = ""
  if (keyword) {
    params.push(`%${keyword}%`)
    keywordSql = `AND (s.account_no ILIKE $1 OR COALESCE(s.client_name, '') ILIKE $1 OR COALESCE(s.company_name, '') ILIKE $1)`
  }
  const sql = `
    WITH latest AS (
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
    SELECT * FROM latest s
     WHERE TRUE ${keywordSql}
     ORDER BY s.account_no
  `
  const rows = await q<Record<string, unknown>>(sql, params)
  const slice = rows.slice(offset, offset + limit)
  return momDataOk({
    accounts: slice,
    total: rows.length,
    limit,
    offset,
    next_offset: offset + slice.length < rows.length ? offset + slice.length : null,
  })
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
  return momDataOk({
    account,
    date: snapshotDate,
    rows,
    total,
    limit,
    offset,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
  })
}

export async function handleAccountRiskDataRequest(
  path: string,
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown>> {
  const key = path.replace(/^\/+|\/+$/g, "")
  try {
    if (key === "" || key === "meta") return catalog()
    if (key === "accounts") return await listAccounts(record)
    if (key.startsWith("account/")) {
      const sheet = SHEETS[key.slice("account/".length)]
      if (!sheet) return momDataErr(1, `unknown path: /${key}`)
      return await readSheet(sheet, record)
    }
    return momDataErr(1, `unknown path: /${key}`)
  } catch (err) {
    if (isMissingRelation(err)) return momDataErr(2, "single-account settlement data is not loaded")
    throw err
  }
}