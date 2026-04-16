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
  const winDays  = dailyPnls.filter(v => v > 0).length
  const winRate  = winDays / n

  const mean     = totalPnl / n
  const variance = dailyPnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n
  const std      = Math.sqrt(variance)
  const sharpe   = std > 0 ? (mean / std) * Math.sqrt(252) : null

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
    maxDdPct,
    profitFactor,
    firstDate,
    lastDate,
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawProduct = (searchParams.get("product") || "AU").toUpperCase().trim()
    if (!/^[A-Z]{1,4}$/.test(rawProduct)) {
      return NextResponse.json({ ok: false, error: "Invalid product" }, { status: 400 })
    }
    const product = rawProduct

    // ── Discover tables ────────────────────────────────────────────────────
    const tablesRes = await rawQuery(
      `SELECT schemaname, tablename FROM pg_tables
       WHERE tablename ILIKE '%mom%trade%' OR tablename ILIKE '%mom%position%'
          OR tablename ILIKE '%trade%detail%' OR tablename ILIKE '%position%detail%'
       ORDER BY tablename`
    )
    const allTables = tablesRes.rows as Array<{ schemaname: string; tablename: string }>
    const findTable = (keys: string[]) => {
      const table = allTables.find(({ tablename }) => {
        const lower = tablename.toLowerCase()
        return !lower.includes("file_state") && keys.every((key) => lower.includes(key.toLowerCase()))
      })
      if (!table) return null
      return `${table.schemaname === "public" ? "" : `"${table.schemaname}".`}"${table.tablename}"`
    }

    const tradeTable =
      findTable(["futures", "trade", "details"]) ??
      findTable(["trade", "details"]) ??
      findTable(["options", "trade", "details"]) ??
      findTable(["trade"])
    const positionTable =
      findTable(["futures", "position", "details"]) ??
      findTable(["position", "details"]) ??
      findTable(["options", "position", "details"]) ??
      findTable(["position"])
    if (!tradeTable || !positionTable) {
      const names = allTables.map(({ schemaname, tablename }) => `${schemaname}.${tablename}`).join(", ")
      throw new Error(`Cannot find trade/position tables. Found: ${names}`)
    }

    // ── Schema introspection ───────────────────────────────────────────────
    const [tSchema, pSchema] = await Promise.all([
      rawQuery(`SELECT * FROM ${tradeTable} LIMIT 0`),
      rawQuery(`SELECT * FROM ${positionTable} LIMIT 0`),
    ])
    const tradeCols    = new Set(tSchema.fields.map((f: { name: string }) => f.name))
    const positionCols = new Set(pSchema.fields.map((f: { name: string }) => f.name))

    const td = pickColumn(tradeCols,    ["交易日期", "成交日期", "日期", "结算日期", "trade_date", "date"])
    const ta = pickColumn(tradeCols,    ["账户", "期货账户", "账号", "客户号", "account"])
    const tp = pickColumn(tradeCols,    ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const rp = pickColumn(tradeCols,    ["平仓盈亏", "realized_pnl", "close_pnl"])
    const ac = pickColumn(tradeCols,    ["开/平", "action", "开平"])
    const pd = pickColumn(positionCols, ["交易日期", "实际成交日期", "日期", "结算日期", "trade_date", "date"])
    const pa = pickColumn(positionCols, ["账户", "期货账户", "账号", "客户号", "account"])
    const pp = pickColumn(positionCols, ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const hp = pickColumn(positionCols, ["持仓盈亏", "holding_pnl", "position_pnl"])

    if (!td || !ta || !tp || !rp) {
      throw new Error(`Trade table missing required columns. Found: ${JSON.stringify([...tradeCols])}`)
    }
    if (!pd || !pa || !pp || !hp) {
      throw new Error(`Position table missing required columns. Found: ${JSON.stringify([...positionCols])}`)
    }

    // Match product: contract col uses regex, direct col uses equality
    const isContractColT = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(tp)
    const isContractColP = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(pp)
    const tradeProductFilter    = isContractColT
      ? `${upperTrimExpr(tp)} ~ ('^' || $1 || '[0-9]')`
      : `${upperTrimExpr(tp)} = $1`
    const positionProductFilter = isContractColP
      ? `${upperTrimExpr(pp)} ~ ('^' || $1 || '[0-9]')`
      : `${upperTrimExpr(pp)} = $1`

    // ── Queries — group by ACCOUNT for fixed product ───────────────────────
    const [realizedRows, holdingRows, closedRows] = await Promise.all([
      query<{ account: string; date: string; pnl: number }>(
        `SELECT ${upperTrimExpr(ta)}           AS account,
                (${quoteIdent(td)}::date)::text AS date,
                SUM(${numericExpr(rp)})         AS pnl
         FROM ${tradeTable}
         WHERE ${tradeProductFilter}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [product],
      ),
      query<{ account: string; date: string; pnl: number }>(
        `SELECT ${upperTrimExpr(pa)}           AS account,
                (${quoteIdent(pd)}::date)::text AS date,
                SUM(${numericExpr(hp)})         AS pnl
         FROM ${positionTable}
         WHERE ${positionProductFilter}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [product],
      ),
      ac
        ? query<{ account: string; count: number }>(
            `SELECT ${upperTrimExpr(ta)} AS account, COUNT(*) AS count
             FROM ${tradeTable}
             WHERE ${tradeProductFilter}
               AND TRIM(${quoteIdent(ac)}) ILIKE '%平%'
             GROUP BY 1`,
            [product],
          )
        : query<{ account: string; count: number }>(
            `SELECT ${upperTrimExpr(ta)} AS account, COUNT(*) AS count
             FROM ${tradeTable}
             WHERE ${tradeProductFilter}
             GROUP BY 1`,
            [product],
          ),
    ])

    // ── Build per-account daily P&L map ────────────────────────────────────
    const accountMap = new Map<string, Map<string, number>>()
    const addRow = (account: string, date: string, pnl: number) => {
      if (!account || !date) return
      if (!accountMap.has(account)) accountMap.set(account, new Map())
      const m = accountMap.get(account)!
      m.set(date, (m.get(date) ?? 0) + pnl)
    }
    for (const r of realizedRows) addRow(r.account, r.date, Number(r.pnl ?? 0))
    for (const r of holdingRows)  addRow(r.account, r.date, Number(r.pnl ?? 0))

    const closeTradeMap = new Map(closedRows.map(r => [r.account, Number(r.count ?? 0)]))

    // ── Compute stats per account ──────────────────────────────────────────
    const rows = []
    for (const [account, dateMap] of accountMap) {
      const sorted      = [...dateMap.entries()].sort(([a], [b]) => a.localeCompare(b))
      const dailyPnls   = sorted.map(([, v]) => v)
      const dates       = sorted.map(([d]) => d)
      const firstDate   = dates[0] ?? ""
      const lastDate    = dates[dates.length - 1] ?? ""
      const closeTrades = closeTradeMap.get(account) ?? 0
      const stats       = computeStats(dailyPnls, closeTrades, firstDate, lastDate)
      if (stats) rows.push({ account, ...stats })
    }

    rows.sort((a, b) => b.totalPnl - a.totalPnl)
    return NextResponse.json({ ok: true, rows, product })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
