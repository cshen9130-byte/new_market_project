import { query } from "@/lib/db"
import { fundDataErr, fundDataOk, type FundDataErr, type FundDataOk } from "@/lib/server/fund-data-api"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import {
  getFundValuationCalendarSummary,
  listFundValuationEmailRecords,
} from "@/lib/server/fund-valuation-allocation"

function num(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function dateText(value: unknown): string | null {
  const s = text(value)
  return s ? s.slice(0, 10) : null
}

function pageArgs(pageRaw: unknown, sizeRaw: unknown, defaultSize: number, maxSize: number) {
  const page = Math.max(1, Math.floor(Number(pageRaw) || 1))
  const pagesize = Math.min(maxSize, Math.max(1, Math.floor(Number(sizeRaw) || defaultSize)))
  return { page, pagesize, offset: (page - 1) * pagesize }
}

export async function listMcpValuationProducts(input: {
  q?: string
  page?: unknown
  pagesize?: unknown
}): Promise<FundDataOk<unknown> | FundDataErr> {
  await ensureEmailValuationTable()
  const { page, pagesize, offset } = pageArgs(input.page, input.pagesize, 50, 200)
  const q = (input.q ?? "").trim()
  const like = q ? `%${q}%` : ""
  const where = q
    ? `WHERE product_code ILIKE $1 OR COALESCE(fund_name, '') ILIKE $1`
    : ""
  const filterParams = q ? [like] : []
  const groupedSql = `
    SELECT
      COALESCE(NULLIF(BTRIM(product_code), ''), '') AS product_code,
      (ARRAY_AGG(NULLIF(BTRIM(fund_name), '') ORDER BY valuation_date DESC NULLS LAST))[1] AS fund_name,
      COUNT(*)::int AS record_count,
      MIN(valuation_date)::text AS date_from,
      MAX(valuation_date)::text AS date_to
    FROM ops_email_valuation_records
    WHERE valuation_date IS NOT NULL
    GROUP BY COALESCE(NULLIF(UPPER(BTRIM(product_code)), ''), 'name:' || LOWER(BTRIM(COALESCE(fund_name, ''))))
  `

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (${groupedSql}) products ${where}`,
    filterParams,
  )
  const total = parseInt(countRows[0]?.count ?? "0", 10)

  const rows = await query<{
    product_code: string
    fund_name: string | null
    record_count: number
    date_from: string | null
    date_to: string | null
  }>(
    `SELECT * FROM (${groupedSql}) products
     ${where}
     ORDER BY date_to DESC NULLS LAST, fund_name
     LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, pagesize, offset],
  )

  return fundDataOk({
    total,
    page,
    pagesize,
    products: rows.map((row) => ({
      reg_code: row.product_code || null,
      fund_name: row.fund_name,
      record_count: row.record_count,
      date_from: dateText(row.date_from),
      date_to: dateText(row.date_to),
    })),
  })
}

export async function listMcpValuationDates(input: {
  reg_code?: string
  q?: string
  page?: unknown
  pagesize?: unknown
}): Promise<FundDataOk<unknown> | FundDataErr> {
  const key = (input.reg_code || input.q || "").trim()
  if (!key) return fundDataErr(1, "reg_code or q is required")
  const { page, pagesize, offset } = pageArgs(input.page, input.pagesize, 100, 500)
  const summary = await getFundValuationCalendarSummary(key)
  const sample = await listFundValuationEmailRecords(key, { limit: 1, offset: 0 })
  const head = sample.records[0]
  const dates = summary.dates.slice(offset, offset + pagesize)
  return fundDataOk({
    reg_code: head?.product_code || input.reg_code || null,
    fund_name: head?.fund_name || null,
    total: summary.total,
    date_from: summary.dateFrom,
    date_to: summary.dateTo,
    page,
    pagesize,
    dates,
  })
}

export async function getMcpValuationSheet(input: {
  reg_code?: string
  q?: string
  date?: string
  record_id?: unknown
  page?: unknown
  pagesize?: unknown
  detail_only?: unknown
}): Promise<FundDataOk<unknown> | FundDataErr> {
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()
  const { page, pagesize, offset } = pageArgs(input.page, input.pagesize, 200, 500)
  const detailOnly =
    input.detail_only === true ||
    input.detail_only === 1 ||
    input.detail_only === "1" ||
    input.detail_only === "true"

  let recordId = Math.floor(Number(input.record_id) || 0)
  if (!recordId) {
    const key = (input.reg_code || input.q || "").trim()
    if (!key) return fundDataErr(1, "reg_code, q, or record_id is required")
    const summary = await getFundValuationCalendarSummary(key)
    const want = (input.date || "").trim().slice(0, 10)
    const entry = want
      ? summary.entries.find((item) => item.date.slice(0, 10) === want)
      : summary.entries[summary.entries.length - 1]
    if (!entry) return fundDataErr(2, want ? "no valuation sheet on that date" : "no valuation sheet")
    recordId = entry.id
  }

  const records = await query<{
    id: number
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    unit_nav: string | null
    cumulative_nav: string | null
    total_asset: string | null
    total_liability: string | null
    net_asset: string | null
    custody_balance: string | null
    net_asset_value: string | null
    paid_in_capital: string | null
    custodian: string | null
    holdings_count: number
  }>(
    `SELECT id, product_code, fund_name, valuation_date::text AS valuation_date,
            unit_nav, cumulative_nav, total_asset, total_liability, net_asset,
            custody_balance, net_asset_value, paid_in_capital, custodian, holdings_count
     FROM ops_email_valuation_records
     WHERE id = $1`,
    [recordId],
  )
  const record = records[0]
  if (!record) return fundDataErr(2, "valuation sheet not found")

  const detailClause = detailOnly ? "AND include_in_detail = TRUE" : ""
  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ops_email_valuation_holdings
     WHERE valuation_record_id = $1 ${detailClause}`,
    [recordId],
  )
  const total = parseInt(countRows[0]?.count ?? "0", 10)
  const holdings = await query<{
    row_index: number
    subject_code: string
    subject_name: string
    symbol: string | null
    row_kind: string | null
    direction: string | null
    asset_class: string | null
    quantity: string | null
    unit_cost: string | null
    cost: string | null
    price: string | null
    market_value: string | null
    market_weight: string | null
    unrealized_pnl: string | null
  }>(
    `SELECT row_index, subject_code, subject_name, symbol, row_kind, direction, asset_class,
            quantity, unit_cost, cost, price, market_value, market_weight, unrealized_pnl
     FROM ops_email_valuation_holdings
     WHERE valuation_record_id = $1 ${detailClause}
     ORDER BY row_index
     LIMIT $2 OFFSET $3`,
    [recordId, pagesize, offset],
  )

  return fundDataOk({
    record_id: record.id,
    reg_code: record.product_code,
    fund_name: record.fund_name,
    valuation_date: dateText(record.valuation_date),
    unit_nav: num(record.unit_nav),
    cumulative_nav: num(record.cumulative_nav),
    total_asset: num(record.total_asset),
    total_liability: num(record.total_liability),
    net_asset: num(record.net_asset),
    custody_balance: num(record.custody_balance),
    net_asset_value: num(record.net_asset_value),
    paid_in_capital: num(record.paid_in_capital),
    custodian: text(record.custodian),
    holdings_count: record.holdings_count,
    detail_only: detailOnly,
    holdings_total: total,
    page,
    pagesize,
    holdings: holdings.map((row) => ({
      row_index: row.row_index,
      subject_code: row.subject_code,
      subject_name: row.subject_name,
      symbol: row.symbol,
      row_kind: row.row_kind,
      direction: row.direction,
      asset_class: row.asset_class,
      quantity: num(row.quantity),
      unit_cost: num(row.unit_cost),
      cost: num(row.cost),
      price: num(row.price),
      market_value: num(row.market_value),
      market_weight: num(row.market_weight),
      unrealized_pnl: num(row.unrealized_pnl),
    })),
  })
}
