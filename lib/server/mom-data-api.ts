/**
 * Read-only MOM account API.
 * Queries public.mom_* only. Does not write, and does not follow the
 * account-risk search_path (see docs/mom-vs-account-risk-isolation.md).
 */

import { publicQuery } from "@/lib/db"
import {
  computeMomAccountMetrics,
  marginUsage,
  type MomDailyPoint,
} from "@/lib/server/mom-data-metrics"

export type MomDataOk<T> = { error_code: 0; msg: "success"; data: T }
export type MomDataErr = { error_code: number; msg: string; data: null }
export type MomDataEnvelope<T> = MomDataOk<T> | MomDataErr

export function momDataOk<T>(data: T): MomDataOk<T> {
  return { error_code: 0, msg: "success", data }
}

export function momDataErr(errorCode: number, msg: string): MomDataErr {
  return { error_code: errorCode, msg, data: null }
}

const ACCOUNT_OK = `
  COALESCE(TRIM("账户"::text), '') <> ''
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
  AND TRIM("账户"::text) NOT LIKE '%国信%'
  AND TRIM("账户"::text) <> '665300200077'
`

function numExpr(col: string): string {
  return `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`
}

function isMissingRelation(err: unknown, table?: string): boolean {
  const code = (err as { code?: string } | null)?.code
  const msg = err instanceof Error ? err.message : String(err)
  if (code !== "42P01" && !msg.includes("does not exist")) return false
  return table ? msg.includes(table) : true
}

async function q<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await publicQuery(sql, params)
  return res.rows as T[]
}

function num(value: unknown): number {
  if (value == null || value === "") return 0
  const n = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

function money(value: number): number {
  return Math.round(value * 100) / 100
}

function ratio(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 1e6) / 1e6
}

function roundMetrics<T>(value: T): T {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null as T
    return (Math.round(value * 1e6) / 1e6) as T
  }
  if (Array.isArray(value)) return value.map((item) => roundMetrics(item)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = roundMetrics(item)
    return out as T
  }
  return value
}

/** Broker 风险度 text. A trailing % is stripped; the number is left in percentage points. */
function riskDegreePct(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null
  const n = Number(text.replace(/,/g, "").replace(/%/g, "").trim())
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
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

function pageArgs(record: Record<string, string | undefined>, fallbackLimit: number) {
  const limitRaw = Number.parseInt(record.limit ?? "", 10)
  const offsetRaw = Number.parseInt(record.offset ?? "", 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(2000, Math.max(1, limitRaw)) : fallbackLimit
  const offset = Number.isFinite(offsetRaw) ? Math.min(200_000, Math.max(0, offsetRaw)) : 0
  const order = record.order === "0" ? "DESC" : "ASC"
  return { limit, offset, order }
}

function dateRange(record: Record<string, string | undefined>): { start: string | null; end: string | null } | MomDataErr {
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  if (record.start_date && !start) return momDataErr(1, "start_date must be YYYY-MM-DD")
  if (record.end_date && !end) return momDataErr(1, "end_date must be YYYY-MM-DD")
  if (start && end && start > end) return momDataErr(1, "start_date must be on or before end_date")
  return { start, end }
}

function requireAccount(record: Record<string, string | undefined>): string | MomDataErr {
  const account = accountCode(record.account)
  if (!account) return momDataErr(1, "account is required")
  return account
}

type Page<T> = {
  account: string
  rows: T[]
  total: number
  limit: number
  offset: number
  next_offset: number | null
}

function pageOf<T>(account: string, rows: T[], total: number, limit: number, offset: number): Page<T> {
  return {
    account,
    rows,
    total,
    limit,
    offset,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
  }
}

const DAILY_SELECT = `
  TRIM("账户"::text) AS account,
  "交易日期"::date::text AS trade_date,
  ${numExpr("上日结存")} AS prev_balance,
  ${numExpr("客户权益")} AS equity,
  ${numExpr("当日存取合计")} AS cashflow,
  ${numExpr("实有货币资金")} AS cash_balance,
  ${numExpr("当日盈亏")} AS daily_pnl,
  ${numExpr("当日手续费")} AS fee,
  ${numExpr("当日结存")} AS ending_balance,
  ${numExpr("保证金占用")} AS margin,
  ${numExpr("可用资金")} AS available,
  NULLIF(TRIM("风险度"::text), '') AS risk_degree,
  ${numExpr("多头期权市値")} AS option_long_mv,
  ${numExpr("空头期权市値")} AS option_short_mv,
  ${numExpr("权利金收入")} AS premium_in,
  ${numExpr("权利金支出")} AS premium_out,
  ${numExpr("平仓盈亏")} AS close_pnl,
  ${numExpr("持仓盈亏")} AS position_pnl,
  ${numExpr("非货币充抖金额")} AS non_cash_offset,
  ${numExpr("当日总权利金")} AS premium_total,
  ${numExpr("货币充抖金额")} AS cash_offset,
  ${numExpr("冻结资金")} AS frozen,
  ${numExpr("追加保证金")} AS margin_call,
  ${numExpr("市値权益")} AS market_value_equity,
  ${numExpr("行权手续费")} AS exercise_fee,
  ${numExpr("行权盈亏")} AS exercise_pnl,
  ${numExpr("申报费")} AS declare_fee,
  (${numExpr("当日盈亏")} - ${numExpr("当日手续费")} + ${numExpr("权利金收入")} - ${numExpr("权利金支出")}) AS pnl_net
`

type DailyRow = {
  account: string
  trade_date: string
  prev_balance: string
  equity: string
  cashflow: string
  cash_balance: string
  daily_pnl: string
  fee: string
  ending_balance: string
  margin: string
  available: string
  risk_degree: string | null
  option_long_mv: string
  option_short_mv: string
  premium_in: string
  premium_out: string
  close_pnl: string
  position_pnl: string
  non_cash_offset: string
  premium_total: string
  cash_offset: string
  frozen: string
  margin_call: string
  market_value_equity: string
  exercise_fee: string
  exercise_pnl: string
  declare_fee: string
  pnl_net: string
  cum_pnl_net?: string
  prev_equity?: string | null
}

function shapeDaily(row: DailyRow) {
  const equity = num(row.equity)
  const margin = num(row.margin)
  const usage = marginUsage(margin, equity)
  const prevEquity = row.prev_equity == null ? null : num(row.prev_equity)
  const pnlNet = num(row.pnl_net)
  const dailyReturn = prevEquity != null && prevEquity > 0 ? pnlNet / prevEquity : null
  return {
    date: String(row.trade_date).slice(0, 10),
    prev_balance: money(num(row.prev_balance)),
    equity: money(equity),
    cashflow: money(num(row.cashflow)),
    cash_balance: money(num(row.cash_balance)),
    daily_pnl: money(num(row.daily_pnl)),
    fee: money(num(row.fee)),
    ending_balance: money(num(row.ending_balance)),
    margin: money(margin),
    available: money(num(row.available)),
    margin_usage: ratio(usage),
    margin_usage_pct: usage == null ? null : Math.round(usage * 10000) / 100,
    risk_degree: row.risk_degree,
    risk_degree_pct: riskDegreePct(row.risk_degree),
    option_long_mv: money(num(row.option_long_mv)),
    option_short_mv: money(num(row.option_short_mv)),
    premium_in: money(num(row.premium_in)),
    premium_out: money(num(row.premium_out)),
    close_pnl: money(num(row.close_pnl)),
    position_pnl: money(num(row.position_pnl)),
    non_cash_offset: money(num(row.non_cash_offset)),
    premium_total: money(num(row.premium_total)),
    cash_offset: money(num(row.cash_offset)),
    frozen: money(num(row.frozen)),
    margin_call: money(num(row.margin_call)),
    market_value_equity: money(num(row.market_value_equity)),
    exercise_fee: money(num(row.exercise_fee)),
    exercise_pnl: money(num(row.exercise_pnl)),
    declare_fee: money(num(row.declare_fee)),
    daily_pnl_net: money(pnlNet),
    cum_pnl_net: money(num(row.cum_pnl_net)),
    prev_equity: prevEquity == null ? null : money(prevEquity),
    daily_return: ratio(dailyReturn),
  }
}

async function accountExists(account: string): Promise<boolean> {
  const rows = await q<{ ok: number }>(
    `SELECT 1 AS ok
       FROM public.mom_daily_reports
      WHERE UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))
        AND ${ACCOUNT_OK}
      LIMIT 1`,
    [account],
  )
  return rows.length > 0
}

async function listAccounts(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const keyword = (record.q ?? "").trim()
  const { limit, offset } = pageArgs(record, 500)
  const params: unknown[] = []
  let keywordAccount = ""
  let keywordAdvisor = ""
  if (keyword) {
    params.push(`%${keyword}%`)
    const slot = `$${params.length}`
    keywordAccount = `AND s.account ILIKE ${slot}`
    keywordAdvisor = `AND (
      s.account ILIKE ${slot}
      OR COALESCE(a.advisor_name, '') ILIKE ${slot}
      OR COALESCE(a.sector, '') ILIKE ${slot}
    )`
  }
  const sql = (withAdvisor: boolean) => `
    WITH daily AS (
      SELECT
        TRIM("账户"::text) AS account,
        "交易日期"::date AS trade_date,
        ${numExpr("客户权益")} AS equity,
        ${numExpr("保证金占用")} AS margin,
        ${numExpr("可用资金")} AS available,
        ${numExpr("当日存取合计")} AS cashflow,
        NULLIF(TRIM("风险度"::text), '') AS risk_degree,
        (${numExpr("当日盈亏")} - ${numExpr("当日手续费")} + ${numExpr("权利金收入")} - ${numExpr("权利金支出")}) AS pnl_net
      FROM public.mom_daily_reports
      WHERE ${ACCOUNT_OK}
    ),
    span AS (
      SELECT account,
             MIN(trade_date)::text AS first_date,
             MAX(trade_date)::text AS last_date,
             COUNT(*)::int AS trading_days
        FROM daily
       GROUP BY account
    ),
    latest AS (
      SELECT DISTINCT ON (account)
             account, trade_date::text AS latest_date, equity, margin, available, cashflow, risk_degree, pnl_net
        FROM daily
       ORDER BY account, trade_date DESC
    )
    SELECT
      s.account,
      s.first_date,
      s.last_date,
      s.trading_days,
      l.latest_date,
      l.equity,
      l.margin,
      l.available,
      l.cashflow,
      l.risk_degree,
      l.pnl_net,
      ${withAdvisor ? "a.advisor_name, a.sector, a.style, a.company" : "NULL::text AS advisor_name, NULL::text AS sector, NULL::text AS style, NULL::text AS company"}
    FROM span s
    JOIN latest l ON l.account = s.account
    ${withAdvisor ? `LEFT JOIN LATERAL (
      SELECT advisor_name, sector, style, company
        FROM public.mom_advisor_info
       WHERE UPPER(TRIM(account_code)) = UPPER(s.account)
       ORDER BY id
       LIMIT 1
    ) a ON TRUE` : ""}
    WHERE TRUE ${withAdvisor ? keywordAdvisor : keywordAccount}
    ORDER BY s.account
  `
  let rows: Array<Record<string, unknown>>
  try {
    rows = await q(sql(true), params)
  } catch (err) {
    if (isMissingRelation(err, "mom_advisor_info")) {
      rows = await q(sql(false), params)
    } else if (isMissingRelation(err, "mom_daily_reports")) {
      return momDataOk({ accounts: [], total: 0, limit, offset, next_offset: null })
    } else {
      throw err
    }
  }
  const total = rows.length
  const slice = rows.slice(offset, offset + limit).map((row) => {
    const equity = num(row.equity)
    const margin = num(row.margin)
    const usage = marginUsage(margin, equity)
    return {
      account: String(row.account),
      advisor_name: row.advisor_name == null ? null : String(row.advisor_name),
      sector: row.sector == null ? null : String(row.sector),
      style: row.style == null ? null : String(row.style),
      company: row.company == null ? null : String(row.company),
      first_date: String(row.first_date).slice(0, 10),
      last_date: String(row.last_date).slice(0, 10),
      trading_days: Number(row.trading_days) || 0,
      latest: {
        date: String(row.latest_date).slice(0, 10),
        equity: money(equity),
        margin: money(margin),
        available: money(num(row.available)),
        cashflow: money(num(row.cashflow)),
        daily_pnl_net: money(num(row.pnl_net)),
        margin_usage: ratio(usage),
        margin_usage_pct: usage == null ? null : Math.round(usage * 10000) / 100,
        risk_degree: row.risk_degree == null ? null : String(row.risk_degree),
        risk_degree_pct: riskDegreePct(row.risk_degree == null ? null : String(row.risk_degree)),
      },
    }
  })
  return momDataOk({
    accounts: slice,
    total,
    limit,
    offset,
    next_offset: offset + slice.length < total ? offset + slice.length : null,
  })
}

async function accountDaily(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const { limit, offset, order } = pageArgs(record, 500)
  const params: unknown[] = [account]
  const filters = [`UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))`, ACCOUNT_OK]
  if (range.start) {
    params.push(range.start)
    filters.push(`"交易日期" >= $${params.length}::date`)
  }
  if (range.end) {
    params.push(range.end)
    filters.push(`"交易日期" <= $${params.length}::date`)
  }
  const where = filters.join(" AND ")
  const countRows = await q<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM public.mom_daily_reports WHERE ${where}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)
  params.push(limit, offset)
  const rows = await q<DailyRow>(
    `WITH base AS (
       SELECT ${DAILY_SELECT}
         FROM public.mom_daily_reports
        WHERE UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))
          AND ${ACCOUNT_OK}
     ),
     calc AS (
       SELECT *,
              SUM(pnl_net) OVER (ORDER BY trade_date ROWS UNBOUNDED PRECEDING) AS cum_pnl_net,
              LAG(equity) OVER (ORDER BY trade_date) AS prev_equity
         FROM base
     )
     SELECT * FROM calc
      WHERE TRUE
        ${range.start ? "AND trade_date >= $2" : ""}
        ${range.end ? `AND trade_date <= $${range.start ? 3 : 2}` : ""}
      ORDER BY trade_date ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return momDataOk(pageOf(account, rows.map(shapeDaily), total, limit, offset))
}

const TRADE_COLS = `
  "交易日期"::date::text AS trade_date,
  NULLIF(TRIM("合约"::text), '') AS contract,
  NULLIF(TRIM("成交编号"::text), '') AS trade_id,
  NULLIF(TRIM("成交时间"::text), '') AS trade_time,
  NULLIF(TRIM("买/卖"::text), '') AS side,
  NULLIF(TRIM("投机/套保"::text), '') AS hedge_flag,
  NULLIF(TRIM("成交价"::text), '') AS price,
  NULLIF(TRIM("手数"::text), '') AS lots,
  NULLIF(TRIM("成交额"::text), '') AS turnover,
  NULLIF(TRIM("开/平"::text), '') AS offset_flag,
  NULLIF(TRIM("手续费"::text), '') AS fee,
  NULLIF(TRIM("平仓盈亏"::text), '') AS close_pnl,
  NULLIF(TRIM("权利金收支"::text), '') AS premium,
  NULLIF(TRIM("资金账户报单编号"::text), '') AS account_order_id,
  NULLIF(TRIM("成交日期"::text), '') AS actual_date,
  NULLIF(TRIM("资金账户成交编号"::text), '') AS account_trade_id,
  NULLIF(TRIM("交易所"::text), '') AS exchange
`

function shapeTrade(market: string, row: Record<string, unknown>) {
  return {
    market,
    date: String(row.trade_date).slice(0, 10),
    contract: row.contract == null ? null : String(row.contract),
    trade_id: row.trade_id == null ? null : String(row.trade_id),
    trade_time: row.trade_time == null ? null : String(row.trade_time),
    side: row.side == null ? null : String(row.side),
    hedge_flag: row.hedge_flag == null ? null : String(row.hedge_flag),
    price: row.price == null ? null : String(row.price),
    lots: row.lots == null ? null : String(row.lots),
    turnover: row.turnover == null ? null : String(row.turnover),
    offset_flag: row.offset_flag == null ? null : String(row.offset_flag),
    fee: row.fee == null ? null : String(row.fee),
    close_pnl: row.close_pnl == null ? null : String(row.close_pnl),
    premium: row.premium == null ? null : String(row.premium),
    account_order_id: row.account_order_id == null ? null : String(row.account_order_id),
    actual_date: row.actual_date == null ? null : String(row.actual_date),
    account_trade_id: row.account_trade_id == null ? null : String(row.account_trade_id),
    exchange: row.exchange == null ? null : String(row.exchange),
  }
}

async function unionPages(
  account: string,
  parts: Array<{ market: string; table: string; select: string }>,
  range: { start: string | null; end: string | null },
  limit: number,
  offset: number,
  order: string,
  shape: (market: string, row: Record<string, unknown>) => unknown,
): Promise<MomDataEnvelope<unknown>> {
  const available: typeof parts = []
  for (const part of parts) {
    try {
      await q(`SELECT 1 FROM public.${part.table} LIMIT 0`)
      available.push(part)
    } catch (err) {
      if (!isMissingRelation(err, part.table)) throw err
    }
  }
  if (available.length === 0) {
    return momDataOk(pageOf(account, [], 0, limit, offset))
  }
  const params: unknown[] = [account]
  const dateSql: string[] = []
  if (range.start) {
    params.push(range.start)
    dateSql.push(`"交易日期" >= $${params.length}::date`)
  }
  if (range.end) {
    params.push(range.end)
    dateSql.push(`"交易日期" <= $${params.length}::date`)
  }
  const where = [
    `UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))`,
    ACCOUNT_OK,
    ...dateSql,
  ].join(" AND ")
  const union = available
    .map((part) => `SELECT '${part.market}' AS market, ${part.select} FROM public.${part.table} WHERE ${where}`)
    .join(" UNION ALL ")
  const countRows = await q<{ total: string }>(`SELECT COUNT(*)::text AS total FROM (${union}) u`, params)
  const total = Number(countRows[0]?.total ?? 0)
  params.push(limit, offset)
  const rows = await q<Record<string, unknown>>(
    `SELECT * FROM (${union}) u ORDER BY trade_date ${order}, market ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return momDataOk(pageOf(
    account,
    rows.map((row) => shape(String(row.market), row)),
    total,
    limit,
    offset,
  ))
}

async function accountTrades(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const market = (record.market ?? "all").trim().toLowerCase()
  const parts = []
  if (market === "detail") {
    return accountDetailTrades(account, range, record)
  }
  if (market === "all" || market === "futures") {
    parts.push({ market: "futures", table: "mom_futures_trade_details", select: TRADE_COLS })
  }
  if (market === "all" || market === "options") {
    parts.push({ market: "options", table: "mom_options_trade_details", select: TRADE_COLS })
  }
  if (parts.length === 0) return momDataErr(1, "market must be all, futures, options, or detail")
  const { limit, offset, order } = pageArgs({ ...record, order: record.order ?? "0" }, 200)
  return unionPages(account, parts, range, limit, offset, order, shapeTrade)
}

async function accountDetailTrades(
  account: string,
  range: { start: string | null; end: string | null },
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown>> {
  const { limit, offset, order } = pageArgs({ ...record, order: record.order ?? "0" }, 200)
  const accountOk = ACCOUNT_OK.replaceAll('"账户"', "account")
  const select = TRADE_COLS.replace('"交易日期"::date::text AS trade_date', "trade_date::date::text AS trade_date")
  const params: unknown[] = [account]
  const dateSql: string[] = []
  if (range.start) {
    params.push(range.start)
    dateSql.push(`trade_date >= $${params.length}::date`)
  }
  if (range.end) {
    params.push(range.end)
    dateSql.push(`trade_date <= $${params.length}::date`)
  }
  const where = [`UPPER(TRIM(account::text)) = UPPER(TRIM($1))`, accountOk, ...dateSql].join(" AND ")
  try {
    const countRows = await q<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM public.mom_trade_details WHERE ${where}`,
      params,
    )
    const total = Number(countRows[0]?.total ?? 0)
    params.push(limit, offset)
    const rows = await q<Record<string, unknown>>(
      `SELECT ${select} FROM public.mom_trade_details WHERE ${where} ORDER BY trade_date ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return momDataOk(pageOf(account, rows.map((row) => shapeTrade("detail", row)), total, limit, offset))
  } catch (err) {
    if (isMissingRelation(err, "mom_trade_details")) return momDataOk(pageOf(account, [], 0, limit, offset))
    throw err
  }
}

const POSITION_COLS = `
  "交易日期"::date::text AS trade_date,
  NULLIF(TRIM("合约"::text), '') AS contract,
  NULLIF(TRIM("成交序号"::text), '') AS trade_id,
  NULLIF(TRIM("买持仓"::text), '') AS long_lots,
  NULLIF(TRIM("买入价"::text), '') AS long_price,
  NULLIF(TRIM("卖持仓"::text), '') AS short_lots,
  NULLIF(TRIM("卖出价"::text), '') AS short_price,
  NULLIF(TRIM("昨结算价"::text), '') AS prev_settle,
  NULLIF(TRIM("今结算价"::text), '') AS settle,
  NULLIF(TRIM("持仓盈亏"::text), '') AS position_pnl,
  NULLIF(TRIM("保证金"::text), '') AS margin,
  NULLIF(TRIM("持仓市値"::text), '') AS market_value,
  NULLIF(TRIM("多头期权市値"::text), '') AS option_long_mv,
  NULLIF(TRIM("空头期权市値"::text), '') AS option_short_mv,
  NULLIF(TRIM("投机/套保"::text), '') AS hedge_flag,
  NULLIF(TRIM("交易编码"::text), '') AS trade_code,
  NULLIF(TRIM("实际成交日期"::text), '') AS actual_date,
  NULLIF(TRIM("期权市値"::text), '') AS option_mv,
  NULLIF(TRIM("交易所"::text), '') AS exchange
`

function shapePosition(market: string, row: Record<string, unknown>) {
  return {
    market,
    date: String(row.trade_date).slice(0, 10),
    contract: row.contract == null ? null : String(row.contract),
    trade_id: row.trade_id == null ? null : String(row.trade_id),
    long_lots: row.long_lots == null ? null : String(row.long_lots),
    long_price: row.long_price == null ? null : String(row.long_price),
    short_lots: row.short_lots == null ? null : String(row.short_lots),
    short_price: row.short_price == null ? null : String(row.short_price),
    prev_settle: row.prev_settle == null ? null : String(row.prev_settle),
    settle: row.settle == null ? null : String(row.settle),
    position_pnl: row.position_pnl == null ? null : String(row.position_pnl),
    margin: row.margin == null ? null : String(row.margin),
    market_value: row.market_value == null ? null : String(row.market_value),
    option_long_mv: row.option_long_mv == null ? null : String(row.option_long_mv),
    option_short_mv: row.option_short_mv == null ? null : String(row.option_short_mv),
    hedge_flag: row.hedge_flag == null ? null : String(row.hedge_flag),
    trade_code: row.trade_code == null ? null : String(row.trade_code),
    actual_date: row.actual_date == null ? null : String(row.actual_date),
    option_mv: row.option_mv == null ? null : String(row.option_mv),
    exchange: row.exchange == null ? null : String(row.exchange),
  }
}

async function accountPositions(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  if (record.date && !isoDate(record.date)) return momDataErr(1, "date must be YYYY-MM-DD")
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const market = (record.market ?? "all").trim().toLowerCase()
  const parts = []
  if (market === "all" || market === "futures") {
    parts.push({ market: "futures", table: "mom_futures_position_details", select: POSITION_COLS })
  }
  if (market === "all" || market === "options") {
    parts.push({ market: "options", table: "mom_options_position_details", select: POSITION_COLS })
  }
  if (market === "detail") {
    parts.push({ market: "detail", table: "mom_position_details", select: POSITION_COLS })
  }
  if (parts.length === 0) return momDataErr(1, "market must be all, futures, options, or detail")
  const date = isoDate(record.date)
  const { limit, offset } = pageArgs(record, 500)
  const range = { start: date, end: date }
  if (!date) {
    let latest: string | null = null
    for (const part of parts) {
      try {
        const rows = await q<{ d: string | null }>(
          `SELECT MAX("交易日期")::text AS d
             FROM public.${part.table}
            WHERE UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))
              AND ${ACCOUNT_OK}`,
          [account],
        )
        const found = rows[0]?.d ? String(rows[0].d).slice(0, 10) : null
        if (found && (!latest || found > latest)) latest = found
      } catch (err) {
        if (!isMissingRelation(err, part.table)) throw err
      }
    }
    if (!latest) return momDataOk({ ...pageOf(account, [], 0, limit, offset), date: null })
    range.start = latest
    range.end = latest
  }
  const result = await unionPages(account, parts, range, limit, offset, "ASC", shapePosition)
  if (result.error_code !== 0) return result
  return momDataOk({ ...result.data as object, date: range.start })
}

async function accountCloses(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const { limit, offset, order } = pageArgs({ ...record, order: record.order ?? "0" }, 200)
  return unionPages(
    account,
    [{
      market: "close",
      table: "mom_close_details",
      select: `
        "交易日期"::date::text AS trade_date,
        NULLIF(TRIM("合约"::text), '') AS contract,
        NULLIF(TRIM("买/卖"::text), '') AS side,
        NULLIF(TRIM("成交价"::text), '') AS close_price,
        NULLIF(TRIM("开仓价"::text), '') AS open_price,
        NULLIF(TRIM("手数"::text), '') AS lots,
        NULLIF(TRIM("昨结算价"::text), '') AS prev_settle,
        NULLIF(TRIM("平仓盈亏"::text), '') AS close_pnl,
        NULLIF(TRIM("交易所"::text), '') AS exchange,
        NULLIF(TRIM("权利金收支"::text), '') AS premium,
        NULLIF(TRIM("开仓日期"::text), '') AS open_date,
        NULLIF(TRIM("开仓成交编号"::text), '') AS open_trade_id,
        NULLIF(TRIM("逐笔平仓盈亏"::text), '') AS tick_close_pnl,
        NULLIF(TRIM("开仓价2"::text), '') AS open_price_2
      `,
    }],
    range,
    limit,
    offset,
    order,
    (_market, row) => ({
      date: String(row.trade_date).slice(0, 10),
      contract: row.contract == null ? null : String(row.contract),
      side: row.side == null ? null : String(row.side),
      close_price: row.close_price == null ? null : String(row.close_price),
      open_price: row.open_price == null ? null : String(row.open_price),
      lots: row.lots == null ? null : String(row.lots),
      prev_settle: row.prev_settle == null ? null : String(row.prev_settle),
      close_pnl: row.close_pnl == null ? null : String(row.close_pnl),
      exchange: row.exchange == null ? null : String(row.exchange),
      premium: row.premium == null ? null : String(row.premium),
      open_date: row.open_date == null ? null : String(row.open_date),
      open_trade_id: row.open_trade_id == null ? null : String(row.open_trade_id),
      tick_close_pnl: row.tick_close_pnl == null ? null : String(row.tick_close_pnl),
      open_price_2: row.open_price_2 == null ? null : String(row.open_price_2),
    }),
  )
}

async function accountProducts(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const { limit, offset, order } = pageArgs(record, 500)
  return unionPages(
    account,
    [{
      market: "product",
      table: "mom_summary_details",
      select: `
        "交易日期"::date::text AS trade_date,
        NULLIF(TRIM("品种"::text), '') AS product,
        NULLIF(TRIM("手数"::text), '') AS lots,
        NULLIF(TRIM("成交额"::text), '') AS turnover,
        NULLIF(TRIM("手续费"::text), '') AS fee,
        NULLIF(TRIM("平仓盈亏"::text), '') AS close_pnl,
        NULLIF(TRIM("交易日"::text), '') AS sheet_trade_date
      `,
    }],
    range,
    limit,
    offset,
    order,
    (_market, row) => ({
      date: String(row.trade_date).slice(0, 10),
      product: row.product == null ? null : String(row.product),
      lots: row.lots == null ? null : String(row.lots),
      turnover: row.turnover == null ? null : String(row.turnover),
      fee: row.fee == null ? null : String(row.fee),
      close_pnl: row.close_pnl == null ? null : String(row.close_pnl),
      sheet_trade_date: row.sheet_trade_date == null ? null : String(row.sheet_trade_date),
    }),
  )
}

async function accountOrders(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const { limit, offset, order } = pageArgs({ ...record, order: record.order ?? "0" }, 200)
  return unionPages(
    account,
    [{
      market: "order",
      table: "mom_order_details",
      select: `
        "交易日期"::date::text AS trade_date,
        NULLIF(TRIM("报单编号"::text), '') AS order_id,
        NULLIF(TRIM("报单时间"::text), '') AS order_time,
        NULLIF(TRIM("合约"::text), '') AS contract,
        NULLIF(TRIM("方向"::text), '') AS side,
        NULLIF(TRIM("开平"::text), '') AS offset_flag,
        NULLIF(TRIM("投保"::text), '') AS hedge_flag,
        NULLIF(TRIM("价格"::text), '') AS price,
        NULLIF(TRIM("委托数量"::text), '') AS order_lots,
        NULLIF(TRIM("成交数量"::text), '') AS filled_lots,
        NULLIF(TRIM("状态"::text), '') AS status,
        NULLIF(TRIM("交易日"::text), '') AS sheet_trade_date,
        NULLIF(TRIM("交易所"::text), '') AS exchange
      `,
    }],
    range,
    limit,
    offset,
    order,
    (_market, row) => ({
      date: String(row.trade_date).slice(0, 10),
      order_id: row.order_id == null ? null : String(row.order_id),
      order_time: row.order_time == null ? null : String(row.order_time),
      contract: row.contract == null ? null : String(row.contract),
      side: row.side == null ? null : String(row.side),
      offset_flag: row.offset_flag == null ? null : String(row.offset_flag),
      hedge_flag: row.hedge_flag == null ? null : String(row.hedge_flag),
      price: row.price == null ? null : String(row.price),
      order_lots: row.order_lots == null ? null : String(row.order_lots),
      filled_lots: row.filled_lots == null ? null : String(row.filled_lots),
      status: row.status == null ? null : String(row.status),
      sheet_trade_date: row.sheet_trade_date == null ? null : String(row.sheet_trade_date),
      exchange: row.exchange == null ? null : String(row.exchange),
    }),
  )
}

async function accountCashflows(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const { limit, offset, order } = pageArgs(record, 200)
  return unionPages(
    account,
    [{
      market: "cashflow",
      table: "mom_daily_report_fund_flows",
      select: `
        "交易日期"::date::text AS trade_date,
        NULLIF(TRIM("发生日期"::text), '') AS occur_date,
        NULLIF(TRIM("方向"::text), '') AS direction,
        NULLIF(TRIM("最大允许亏损金额"::text), '') AS max_loss_amount,
        NULLIF(TRIM("不可亏损金额"::text), '') AS protected_amount,
        NULLIF(TRIM("说明"::text), '') AS note
      `,
    }],
    range,
    limit,
    offset,
    order,
    (_market, row) => ({
      date: String(row.trade_date).slice(0, 10),
      occur_date: row.occur_date == null ? null : String(row.occur_date),
      direction: row.direction == null ? null : String(row.direction),
      max_loss_amount: row.max_loss_amount == null ? null : String(row.max_loss_amount),
      protected_amount: row.protected_amount == null ? null : String(row.protected_amount),
      note: row.note == null ? null : String(row.note),
    }),
  )
}

async function loadDailyPoints(account: string, start: string | null, end: string | null): Promise<MomDailyPoint[]> {
  const params: unknown[] = [account]
  const filters = [`UPPER(TRIM("账户"::text)) = UPPER(TRIM($1))`, ACCOUNT_OK]
  if (start) {
    params.push(start)
    filters.push(`"交易日期" >= $${params.length}::date`)
  }
  if (end) {
    params.push(end)
    filters.push(`"交易日期" <= $${params.length}::date`)
  }
  const rows = await q<Pick<DailyRow, "trade_date" | "equity" | "margin" | "pnl_net" | "risk_degree">>(
    `SELECT "交易日期"::date::text AS trade_date,
            ${numExpr("客户权益")} AS equity,
            ${numExpr("保证金占用")} AS margin,
            (${numExpr("当日盈亏")} - ${numExpr("当日手续费")} + ${numExpr("权利金收入")} - ${numExpr("权利金支出")}) AS pnl_net,
            NULLIF(TRIM("风险度"::text), '') AS risk_degree
       FROM public.mom_daily_reports
      WHERE ${filters.join(" AND ")}
      ORDER BY "交易日期" ASC`,
    params,
  )
  return rows.map((row) => ({
    date: String(row.trade_date).slice(0, 10),
    equity: num(row.equity),
    margin: num(row.margin),
    pnlNet: num(row.pnl_net),
    riskDegree: row.risk_degree,
  }))
}

async function accountMetrics(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const account = requireAccount(record)
  if (typeof account !== "string") return account
  const range = dateRange(record)
  if ("error_code" in range) return range
  if (!(await accountExists(account))) return momDataErr(2, "account not found")
  const points = await loadDailyPoints(account, range.start, range.end)
  const metrics = roundMetrics(computeMomAccountMetrics(points))
  const latest = points[points.length - 1]
  const usage = latest ? marginUsage(latest.margin, latest.equity) : null
  return momDataOk({
    account,
    start_date: points[0]?.date ?? range.start,
    end_date: latest?.date ?? range.end,
    ...metrics,
    latest: latest
      ? {
          date: latest.date,
          equity: money(latest.equity),
          margin: money(latest.margin),
          daily_pnl_net: money(latest.pnlNet),
          margin_usage: ratio(usage),
          margin_usage_pct: usage == null ? null : Math.round(usage * 10000) / 100,
          risk_degree: latest.riskDegree,
          risk_degree_pct: riskDegreePct(latest.riskDegree),
        }
      : null,
    formulas: {
      daily_pnl_net: "当日盈亏 - 当日手续费 + 权利金收入 - 权利金支出",
      daily_return: "当日净盈亏 / 上一日客户权益",
      margin_usage: "保证金占用 / 客户权益",
      var: "历史模拟法。日收益率升序后的 5% / 1% 分位。var_*_loss 把亏损写成正数。样本少于 20 个日收益率时 VaR 为空。",
      sharpe: "日收益率均值 / 样本标准差 × sqrt(252)，无风险利率按 0",
      max_drawdown: "客户权益序列的峰值回撤，正数比例",
    },
  })
}

function catalog() {
  return momDataOk({
    name: "mom-data",
    auth: "Dedicated MOM API key (prefix mk_), issued on the MOM数据API page. The fund-data key is rejected. The account must have MOM数据API enabled.",
    endpoints: [
      { method: "GET", path: "/accounts", description: "账户列表，含最新权益、保证金使用率和风险度" },
      { method: "GET", path: "/account/daily", description: "单账户每日核算：权益、盈亏、保证金使用率、风险度" },
      { method: "GET", path: "/account/trades", description: "期货成交、期权成交，以及 market=detail 的成交明细原表" },
      { method: "GET", path: "/account/positions", description: "期货持仓、期权持仓，以及 market=detail 的持仓明细原表。默认最近一个交易日" },
      { method: "GET", path: "/account/closes", description: "平仓明细" },
      { method: "GET", path: "/account/orders", description: "委托明细" },
      { method: "GET", path: "/account/products", description: "品种汇总" },
      { method: "GET", path: "/account/cashflows", description: "核算日报出入金明细" },
      { method: "GET", path: "/account/metrics", description: "区间胜率、夏普、最大回撤、保证金使用率分布、历史 VaR / CVaR" },
    ],
    single_account: {
      base: "/ma/api/account-risk/data",
      auth: "Same MOM API key. Reads public.cfmmc_* written by the 单账户监控中心 import. Does not read public.mom_*.",
    },
  })
}

export async function handleMomDataRequest(
  path: string,
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown>> {
  const key = path.replace(/^\/+|\/+$/g, "")
  try {
    switch (key) {
      case "":
      case "meta":
        return catalog()
      case "accounts":
        return await listAccounts(record)
      case "account/daily":
        return await accountDaily(record)
      case "account/trades":
        return await accountTrades(record)
      case "account/positions":
        return await accountPositions(record)
      case "account/closes":
        return await accountCloses(record)
      case "account/orders":
        return await accountOrders(record)
      case "account/products":
        return await accountProducts(record)
      case "account/cashflows":
        return await accountCashflows(record)
      case "account/metrics":
        return await accountMetrics(record)
      default:
        return momDataErr(1, `unknown path: /${key}`)
    }
  } catch (err) {
    if (isMissingRelation(err)) {
      return momDataErr(2, "MOM data is not loaded")
    }
    throw err
  }
}

export function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {}
  searchParams.forEach((value, key) => {
    record[key] = value
  })
  return record
}
