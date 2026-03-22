import { NextResponse } from "next/server"
import { query, rawQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`
}
function pickColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c
  return null
}
function numericExpr(col: string) {
  return `COALESCE(CAST(NULLIF(TRIM(COALESCE(${quoteIdent(col)}::text, '')), '') AS float8), 0)`
}
function upperTrimExpr(col: string) {
  return `UPPER(TRIM(${quoteIdent(col)}::text))`
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || "2025-01-01"
    const to   = searchParams.get("to")   || new Date().toISOString().slice(0, 10)
    const rawProduct = (searchParams.get("product") || "AU").toUpperCase().trim()
    const product = /^[A-Z]{1,4}$/.test(rawProduct) ? rawProduct : "AU"
    const initialCapital = 1_000_000

    // ── Discover tables ──────────────────────────────────────────────────────
    const allTables = await query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename FROM pg_tables
       WHERE tablename ILIKE '%mom%trade%' OR tablename ILIKE '%mom%position%'
          OR tablename ILIKE '%trade%detail%' OR tablename ILIKE '%position%detail%'
       ORDER BY tablename`
    )
    const findTable = (keywords: string[]): string | null => {
      const t = allTables.find((r) =>
        keywords.every((kw) => r.tablename.toLowerCase().includes(kw.toLowerCase()))
      )
      return t ? `${t.schemaname === "public" ? "" : `"${t.schemaname}".`}"${t.tablename}"` : null
    }
    const tradeTable    = findTable(["trade"])    ?? findTable(["mom"])
    const positionTable = findTable(["position"])
    if (!tradeTable || !positionTable) throw new Error("Cannot find trade/position tables")

    // ── Discover columns ─────────────────────────────────────────────────────
    const [tradeSch, positionSch] = await Promise.all([
      rawQuery(`SELECT * FROM ${tradeTable} LIMIT 0`),
      rawQuery(`SELECT * FROM ${positionTable} LIMIT 0`),
    ])
    const tradeCols    = new Set(tradeSch.fields.map((f) => f.name))
    const positionCols = new Set(positionSch.fields.map((f) => f.name))

    const td = pickColumn(tradeCols,    ["交易日期","日期","结算日期","trade_date","date"])
    const ta = pickColumn(tradeCols,    ["账户","期货账户","账号","客户号","account"])
    const tp = pickColumn(tradeCols,    ["品种","品种代码","合约","合约代码","contract","symbol"])
    const rp = pickColumn(tradeCols,    ["平仓盈亏","realized_pnl","close_pnl"])
    const pd = pickColumn(positionCols, ["交易日期","日期","结算日期","trade_date","date"])
    const pa = pickColumn(positionCols, ["账户","期货账户","账号","客户号","account"])
    const pp = pickColumn(positionCols, ["品种","品种代码","合约","合约代码","contract","symbol"])
    const hp = pickColumn(positionCols, ["持仓盈亏","holding_pnl","position_pnl"])

    if (!td || !ta || !tp || !rp || !pd || !pa || !pp || !hp) {
      throw new Error("Missing required columns")
    }

    const tradeProductExpr =
      ["品种代码","合约","合约代码","contract","symbol"].includes(tp)
        ? `${upperTrimExpr(tp)} ~ ('^' || $1 || '[0-9]')`
        : `${upperTrimExpr(tp)} = $1`
    const positionProductExpr =
      ["品种代码","合约","合约代码","contract","symbol"].includes(pp)
        ? `${upperTrimExpr(pp)} ~ ('^' || $1 || '[0-9]')`
        : `${upperTrimExpr(pp)} = $1`

    // ── Fetch realized PnL, holding PnL, and benchmark in parallel ───────────
    type PnlRow = { date: string; account: string; pnl: number }
    type BmRow  = { date: string; close: number; preclose: number }

    const [realizedRows, holdingRows, benchmarkRows] = await Promise.all([
      query<PnlRow>(
        `SELECT (${quoteIdent(td)}::date)::text AS date,
                ${upperTrimExpr(ta)}            AS account,
                SUM(${numericExpr(rp)})         AS pnl
         FROM ${tradeTable}
         WHERE ${tradeProductExpr}
           AND ${quoteIdent(td)}::date BETWEEN $2::date AND $3::date
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [product, from, to],
      ),
      query<PnlRow>(
        `SELECT (${quoteIdent(pd)}::date)::text AS date,
                ${upperTrimExpr(pa)}            AS account,
                SUM(${numericExpr(hp)})         AS pnl
         FROM ${positionTable}
         WHERE ${positionProductExpr}
           AND ${quoteIdent(pd)}::date BETWEEN $2::date AND $3::date
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [product, from, to],
      ),
      // Dominant contract (highest OI) per day as benchmark
      query<BmRow>(
        `WITH ranked AS (
           SELECT trade_date::text AS date,
                  CAST(close AS float8)                          AS close,
                  CAST(COALESCE(preclose, close) AS float8)      AS preclose,
                  ROW_NUMBER() OVER (
                    PARTITION BY trade_date
                    ORDER BY COALESCE(hqoi, 0) DESC, COALESCE(volume, 0) DESC
                  ) AS rn
           FROM raw_futures_contracts_daily
           WHERE UPPER(contract) ~ ('^' || $1 || '[0-9]')
             AND trade_date BETWEEN $2 AND $3
         )
         SELECT date, close, preclose FROM ranked WHERE rn = 1 ORDER BY date`,
        [product, from, to],
      ).catch(() => [] as BmRow[]),
    ])

    // ── Merge PnL by account + date ──────────────────────────────────────────
    // account → date → cumulative pnl map
    const pnlMap = new Map<string, Map<string, number>>()
    for (const row of [...realizedRows, ...holdingRows]) {
      if (!pnlMap.has(row.account)) pnlMap.set(row.account, new Map())
      const dm = pnlMap.get(row.account)!
      dm.set(row.date, (dm.get(row.date) || 0) + Number(row.pnl || 0))
    }

    // Build sorted cumulative series per account
    const accounts = [...pnlMap.keys()].sort()
    const series = accounts.map((acc) => {
      const dm = pnlMap.get(acc)!
      let cumPnl = 0
      const data = [...dm.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, pnl]) => {
          cumPnl += pnl
          return { date, pct: parseFloat((cumPnl / initialCapital * 100).toFixed(3)) }
        })
      return { account: acc, data }
    })

    // Build benchmark cumulative % return
    let bmCumPct = 0
    const benchmark = benchmarkRows.map((row) => {
      if (row.preclose && row.preclose !== 0) {
        bmCumPct += (row.close - row.preclose) / row.preclose * 100
      }
      return { date: row.date, pct: parseFloat(bmCumPct.toFixed(3)) }
    })

    return NextResponse.json({ ok: true, accounts, series, benchmark })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
