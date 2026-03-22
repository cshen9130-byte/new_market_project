import { NextResponse } from "next/server"
import { query, rawQuery } from "@/lib/db"

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (columns.has(c)) return c
  return null
}
function upperTrimExpr(col: string): string {
  return `UPPER(TRIM(${quoteIdent(col)}::text))`
}
function numericExpr(col: string): string {
  return `CAST(NULLIF(TRIM(${quoteIdent(col)}::text),'') AS float8)`
}

function computeStats(dailyPnls: number[], closeTrades: number, firstDate: string, lastDate: string) {
  const n = dailyPnls.length
  if (n === 0) return null
  const totalPnl = dailyPnls.reduce((s, v) => s + v, 0)
  const winDays = dailyPnls.filter(v => v > 0).length
  const winRate = winDays / n

  const mean = totalPnl / n
  const variance = dailyPnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : null

  // Max drawdown — identical method to au-trading chart:
  // equity = initialCapital + cumPnl, so the denominator is always large enough
  // to prevent tiny-peak explosions. Same default initialCapital = 1,000,000.
  const initialCapital = 1_000_000
  let peakEquity = initialCapital, peakAtMaxDd = initialCapital, cum = 0, maxDd = 0
  for (const p of dailyPnls) {
    cum += p
    const equity = initialCapital + cum
    if (equity > peakEquity) peakEquity = equity
    const dd = peakEquity - equity
    if (dd > maxDd) { maxDd = dd; peakAtMaxDd = peakEquity }
  }
  const maxDdPct = peakAtMaxDd > 0 ? maxDd / peakAtMaxDd : 0

  const winSum  = dailyPnls.filter(v => v > 0).reduce((s, v) => s + v, 0)
  const lossSum = Math.abs(dailyPnls.filter(v => v < 0).reduce((s, v) => s + v, 0))
  const profitFactor = lossSum > 0 ? winSum / lossSum : null

  return {
    totalPnl: Math.round(totalPnl),
    tradingDays: n,
    closeTrades,
    winRate,
    sharpe,
    maxDdPct: maxDdPct,
    profitFactor,
    firstDate,
    lastDate,
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawAccount = (searchParams.get("account") || "rx000").trim()
    // Validate: only allow safe account identifiers
    if (!/^[a-zA-Z0-9_\-]+$/.test(rawAccount)) {
      return NextResponse.json({ ok: false, error: "Invalid account" }, { status: 400 })
    }
    const account = rawAccount

    // ── Discover tables ────────────────────────────────────────────────────
    const tablesRes = await rawQuery(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND (tablename ILIKE '%mom%trade%' OR tablename ILIKE '%mom%position%'
         OR tablename ILIKE '%trade%detail%' OR tablename ILIKE '%position%detail%')`
    )
    const names = tablesRes.rows.map((r: { tablename: string }) => r.tablename)
    const findTable = (keys: string[]) =>
      names.find((n: string) => keys.every(k => n.toLowerCase().includes(k.toLowerCase()))) ?? null

    const tradeTable    = findTable(["trade"])
    const positionTable = findTable(["position"])
    if (!tradeTable || !positionTable) {
      throw new Error("Cannot find trade/position tables")
    }

    // ── Schema introspection ───────────────────────────────────────────────
    const [tSchema, pSchema] = await Promise.all([
      rawQuery(`SELECT * FROM ${tradeTable} LIMIT 0`),
      rawQuery(`SELECT * FROM ${positionTable} LIMIT 0`),
    ])
    const tradeCols    = new Set(tSchema.fields.map((f: { name: string }) => f.name))
    const positionCols = new Set(pSchema.fields.map((f: { name: string }) => f.name))

    const td = pickColumn(tradeCols,    ["交易日期", "日期", "结算日期", "trade_date", "date"])
    const ta = pickColumn(tradeCols,    ["账户", "期货账户", "账号", "客户号", "account"])
    const tp = pickColumn(tradeCols,    ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const rp = pickColumn(tradeCols,    ["平仓盈亏", "realized_pnl", "close_pnl"])
    const ac = pickColumn(tradeCols,    ["开/平", "action", "开平"])

    const pd = pickColumn(positionCols, ["交易日期", "日期", "结算日期", "trade_date", "date"])
    const pa = pickColumn(positionCols, ["账户", "期货账户", "账号", "客户号", "account"])
    const pp = pickColumn(positionCols, ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const hp = pickColumn(positionCols, ["持仓盈亏", "holding_pnl", "position_pnl"])

    if (!td || !ta || !tp || !rp) throw new Error("Trade table missing required columns")
    if (!pd || !pa || !pp || !hp) throw new Error("Position table missing required columns")

    // When column is a full contract code (e.g. "AU2501"), strip trailing digits to get product
    const isContractCol    = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(tp)
    const isPosContractCol = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(pp)
    const tradeProductExpr = isContractCol
      ? `REGEXP_REPLACE(${upperTrimExpr(tp)}, '[0-9].*$', '')`
      : upperTrimExpr(tp)
    const posProductExpr = isPosContractCol
      ? `REGEXP_REPLACE(${upperTrimExpr(pp)}, '[0-9].*$', '')`
      : upperTrimExpr(pp)

    // ── Queries ────────────────────────────────────────────────────────────
    const [realizedRows, holdingRows, closedRows] = await Promise.all([
      query<{ product: string; date: string; pnl: number }>(
        `SELECT ${tradeProductExpr}          AS product,
                (${quoteIdent(td)}::date)::text AS date,
                SUM(${numericExpr(rp)})         AS pnl
         FROM ${tradeTable}
         WHERE ${upperTrimExpr(ta)} ILIKE $1
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [`%${account.toUpperCase()}%`],
      ),
      query<{ product: string; date: string; pnl: number }>(
        `SELECT ${posProductExpr}            AS product,
                (${quoteIdent(pd)}::date)::text AS date,
                SUM(${numericExpr(hp)})         AS pnl
         FROM ${positionTable}
         WHERE ${upperTrimExpr(pa)} ILIKE $1
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [`%${account.toUpperCase()}%`],
      ),
      // Count closed trades per product
      ac
        ? query<{ product: string; count: number }>(
            `SELECT ${tradeProductExpr} AS product, COUNT(*) AS count
             FROM ${tradeTable}
             WHERE ${upperTrimExpr(ta)} ILIKE $1
               AND TRIM(${quoteIdent(ac)}) ILIKE '%平%'
             GROUP BY 1`,
            [`%${account.toUpperCase()}%`],
          )
        : query<{ product: string; count: number }>(
            `SELECT ${tradeProductExpr} AS product, COUNT(*) AS count
             FROM ${tradeTable}
             WHERE ${upperTrimExpr(ta)} ILIKE $1
             GROUP BY 1`,
            [`%${account.toUpperCase()}%`],
          ),
    ])

    // ── Build per-product daily P&L map ────────────────────────────────────
    const productMap = new Map<string, Map<string, number>>()
    const addRow = (product: string, date: string, pnl: number) => {
      if (!product || !date) return
      if (!productMap.has(product)) productMap.set(product, new Map())
      const m = productMap.get(product)!
      m.set(date, (m.get(date) ?? 0) + pnl)
    }
    for (const r of realizedRows) addRow(r.product, r.date, Number(r.pnl ?? 0))
    for (const r of holdingRows)  addRow(r.product, r.date, Number(r.pnl ?? 0))

    const closeTradeMap = new Map(closedRows.map(r => [r.product, Number(r.count ?? 0)]))

    // ── Compute stats per product ──────────────────────────────────────────
    const rows = []
    for (const [product, dateMap] of productMap) {
      const sorted     = [...dateMap.entries()].sort(([a], [b]) => a.localeCompare(b))
      const dailyPnls  = sorted.map(([, v]) => v)
      const dates      = sorted.map(([d]) => d)
      const firstDate  = dates[0] ?? ""
      const lastDate   = dates[dates.length - 1] ?? ""
      const closeTrades = closeTradeMap.get(product) ?? 0
      const stats = computeStats(dailyPnls, closeTrades, firstDate, lastDate)
      if (stats) rows.push({ product, ...stats })
    }

    rows.sort((a, b) => b.totalPnl - a.totalPnl)
    return NextResponse.json({ ok: true, rows })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
