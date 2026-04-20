import { NextResponse } from "next/server"
import { query, rawQuery } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const INITIAL_CAPITAL = 1_000_000

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

const AKSHARE_CODE: Record<string, string> = {
  A:"A0.DCE", AD:"AD0.SHF", AG:"AG0.SHF", AL:"AL0.SHF", AO:"AO0.SHF", AP:"AP0.CZC",
  AU:"AU0.SHF", B:"B0.DCE", BB:"BB0.DCE", BC:"BCM.INE", BR:"BR0.SHF", BU:"BU0.SHF",
  BZ:"BZ0.DCE", C:"C0.DCE", CF:"CF0.CZC", CJ:"CJ0.CZC", CS:"CS0.DCE", CU:"CU0.SHF",
  CY:"CY0.CZC", EB:"EB0.DCE", EC:"ECM.INE", EG:"EG0.DCE", FB:"FB0.DCE", FG:"FG0.CZC",
  FU:"FU0.SHF", HC:"HC0.SHF", I:"I0.DCE", IC:"IC0.CFE", IF:"IF0.CFE", IH:"IH0.CFE",
  IM:"IM0.CFE", J:"J0.DCE", JD:"JD0.DCE", JM:"JM0.DCE", JR:"JR0.CZC", L:"L0.DCE",
  LC:"LCM.GFE", LG:"LG0.DCE", LH:"LH0.DCE", LR:"LR0.CZC", LU:"LUM.INE",
  M:"M0.DCE", MA:"MA0.CZC", NI:"NI0.SHF", NR:"NRM.INE", OI:"OI0.CZC", OP:"OP0.SHF",
  P:"P0.DCE", PB:"PB0.SHF", PF:"PF0.CZC", PG:"PG0.DCE", PK:"PK0.CZC",
  PL:"PL0.CZC", PM:"PM0.CZC", PP:"PP0.DCE", PR:"PR0.CZC",
  PX:"PX0.CZC", RB:"RB0.SHF", RI:"RI0.CZC", RM:"RM0.CZC", RR:"RR0.DCE", RS:"RS0.CZC",
  RU:"RU0.SHF", SA:"SA0.CZC", SC:"SCM.INE", SF:"SF0.CZC", SH:"SH0.CZC",
  SM:"SM0.CZC", SN:"SN0.SHF", SP:"SP0.SHF", SR:"SR0.CZC", SS:"SS0.SHF", TA:"TA0.CZC",
  T:"T0.CFE", TF:"TF0.CFE", TL:"TL0.CFE", TS:"TS0.CFE", UR:"UR0.CZC", V:"V0.DCE",
  WH:"WH0.CZC", WR:"WR0.SHF", Y:"Y0.DCE", ZC:"ZC0.CZC", ZN:"ZN0.SHF",
}

async function _GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from         = searchParams.get("from")          || "2025-01-01"
    const to           = searchParams.get("to")            || new Date().toISOString().slice(0, 10)
    const rawProduct   = (searchParams.get("product")      || "全部").trim()
    const product      = rawProduct === "全部" ? "全部" : rawProduct.toUpperCase().replace(/[^A-Z]/g, "")
    const advisorSector      = searchParams.get("advisorSector")   || "全部"
    const advisorBackground  = searchParams.get("background")      || "全部"
    const advisorStyle       = searchParams.get("style")           || "全部"
    const advisorCycle       = searchParams.get("cycle")           || "全部"
    const advisorIsArbitrage = searchParams.get("isArbitrage")     || "全部"
    const advisorStrength    = searchParams.get("mainStrength")    || "全部"
    const advisorRegion      = searchParams.get("region")          || "全部"

    // ── 1. Fetch advisor info + allowed accounts ──────────────────────────────
    type InfoRow = {
      account_code: string; sector: string
      background: string; style: string; cycle: string
      is_arbitrage: string; main_strength: string; region: string
    }
    let advisorSectors:     string[] = []
    let advisorBackgrounds: string[] = []
    let advisorStyles:      string[] = []
    let advisorCycles:      string[] = []
    let advisorArbitrages:  string[] = []
    let advisorStrengths:   string[] = []
    let advisorRegions:     string[] = []
    let allowedAccounts: Set<string> | null = null
    try {
      const infoRows = await query<InfoRow>(
        `SELECT UPPER(TRIM(account_code))                             AS account_code,
                COALESCE(NULLIF(TRIM(sector),       ''), '未分类')   AS sector,
                COALESCE(NULLIF(TRIM(background),   ''), '未知')     AS background,
                COALESCE(NULLIF(TRIM(style),        ''), '未知')     AS style,
                COALESCE(NULLIF(TRIM(cycle),        ''), '未知')     AS cycle,
                COALESCE(NULLIF(TRIM(is_arbitrage::text), ''), '未知') AS is_arbitrage,
                COALESCE(NULLIF(TRIM(main_strength), ''), '未知')    AS main_strength,
                COALESCE(NULLIF(TRIM(region),       ''), '未知')     AS region
         FROM mom_advisor_info ORDER BY sector, account_code`,
      )
      advisorSectors     = [...new Set(infoRows.map((r) => r.sector))].sort()
      advisorBackgrounds = [...new Set(infoRows.map((r) => r.background))].sort()
      advisorStyles      = [...new Set(infoRows.map((r) => r.style))].sort()
      advisorCycles      = [...new Set(infoRows.map((r) => r.cycle))].sort()
      advisorArbitrages  = [...new Set(infoRows.map((r) => r.is_arbitrage))].sort()
      advisorStrengths   = [...new Set(infoRows.map((r) => r.main_strength))].sort()
      advisorRegions     = [...new Set(infoRows.map((r) => r.region))].sort()

      // Build allowedAccounts by intersecting all active filters
      let filtered = infoRows
      if (advisorSector      !== "全部") filtered = filtered.filter((r) => r.sector       === advisorSector)
      if (advisorBackground  !== "全部") filtered = filtered.filter((r) => r.background   === advisorBackground)
      if (advisorStyle       !== "全部") filtered = filtered.filter((r) => r.style        === advisorStyle)
      if (advisorCycle       !== "全部") filtered = filtered.filter((r) => r.cycle        === advisorCycle)
      if (advisorIsArbitrage !== "全部") filtered = filtered.filter((r) => r.is_arbitrage === advisorIsArbitrage)
      if (advisorStrength    !== "全部") filtered = filtered.filter((r) => r.main_strength === advisorStrength)
      if (advisorRegion      !== "全部") filtered = filtered.filter((r) => r.region       === advisorRegion)
      if (
        advisorSector !== "全部" || advisorBackground !== "全部" || advisorStyle !== "全部" ||
        advisorCycle  !== "全部" || advisorIsArbitrage !== "全部" || advisorStrength !== "全部" ||
        advisorRegion !== "全部"
      ) {
        allowedAccounts = new Set(filtered.map((r) => r.account_code))
      }
    } catch {
      // table might not exist yet
    }

    const advisorMeta = {
      advisorSectors, advisorBackgrounds, advisorStyles, advisorCycles,
      advisorArbitrages, advisorStrengths, advisorRegions,
    }

    // Helper: add account filter to params array, return SQL fragment
    const buildAccountFilter = (colExpr: string, params: unknown[]): string => {
      if (!allowedAccounts || allowedAccounts.size === 0) return ""
      params.push([...allowedAccounts])
      return `AND ${colExpr} = ANY($${params.length})`
    }

    // ── 2a. product = "全部" — use mom_daily_reports ─────────────────────────
    if (product === "全部") {
      const params: unknown[] = [from, to]
      const accountFilter = buildAccountFilter(`UPPER(TRIM("账户"::text))`, params)

      const rows = await query<{ account: string; date: string; daily_pnl: string }>(
        `SELECT UPPER(TRIM("账户"::text)) AS account,
                "交易日期"::text AS date,
                COALESCE(
                  NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏"::text, ''), ',', ''), ' ', ''), '')::numeric,
                  0
                )::text AS daily_pnl
         FROM mom_daily_reports
         WHERE "交易日期"::date BETWEEN $1::date AND $2::date
         ${accountFilter}
         ORDER BY "交易日期", "账户"`,
        params,
      )

      const pnlMap = new Map<string, Map<string, number>>()
      for (const row of rows) {
        if (!pnlMap.has(row.account)) pnlMap.set(row.account, new Map())
        const dm = pnlMap.get(row.account)!
        dm.set(row.date, (dm.get(row.date) ?? 0) + Number(row.daily_pnl || 0))
      }

      const accounts = [...pnlMap.keys()].sort()
      const series = accounts.map((acc) => {
        let cum = 0
        const data = [...pnlMap.get(acc)!.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, pnl]) => {
            cum += pnl
            return { date, pct: parseFloat(((cum / INITIAL_CAPITAL) * 100).toFixed(3)) }
          })
        return { account: acc.toLowerCase(), data }
      })

      return NextResponse.json({ ok: true, accounts, series, benchmark: [], ...advisorMeta })
    }

    // ── 2b. Specific product — use trade/position tables ─────────────────────
    const allTables = await query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename FROM pg_tables
       WHERE tablename ILIKE '%mom%trade%' OR tablename ILIKE '%mom%position%'
          OR tablename ILIKE '%trade%detail%' OR tablename ILIKE '%position%detail%'
       ORDER BY tablename`,
    )
    const findTable = (keywords: string[]): string | null => {
      const t = allTables.find(
        (r) =>
          !r.tablename.toLowerCase().includes("file_state") &&
          keywords.every((kw) => r.tablename.toLowerCase().includes(kw.toLowerCase())),
      )
      return t ? `${t.schemaname === "public" ? "" : `"${t.schemaname}".`}"${t.tablename}"` : null
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
      throw new Error("Cannot find trade/position tables")
    }

    const [tradeSch, positionSch] = await Promise.all([
      rawQuery(`SELECT * FROM ${tradeTable} LIMIT 0`),
      rawQuery(`SELECT * FROM ${positionTable} LIMIT 0`),
    ])
    const tradeCols    = new Set(tradeSch.fields.map((f) => f.name))
    const positionCols = new Set(positionSch.fields.map((f) => f.name))

    const td = pickColumn(tradeCols,    ["交易日期", "成交日期", "日期", "结算日期", "trade_date", "date"])
    const ta = pickColumn(tradeCols,    ["账户", "期货账户", "账号", "客户号", "account"])
    const tp = pickColumn(tradeCols,    ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const rp = pickColumn(tradeCols,    ["平仓盈亏", "realized_pnl", "close_pnl"])
    const pd = pickColumn(positionCols, ["交易日期", "实际成交日期", "日期", "结算日期", "trade_date", "date"])
    const pa = pickColumn(positionCols, ["账户", "期货账户", "账号", "客户号", "account"])
    const pp = pickColumn(positionCols, ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
    const hp = pickColumn(positionCols, ["持仓盈亏", "holding_pnl", "position_pnl"])
    if (!td || !ta || !tp || !rp || !pd || !pa || !pp || !hp) {
      throw new Error("Missing required columns")
    }

    const tradeProductExpr =
      ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(tp)
        ? `${upperTrimExpr(tp)} ~ ('^' || $1 || '[0-9]')`
        : `${upperTrimExpr(tp)} = $1`
    const positionProductExpr =
      ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(pp)
        ? `${upperTrimExpr(pp)} ~ ('^' || $1 || '[0-9]')`
        : `${upperTrimExpr(pp)} = $1`

    const tradeParams: unknown[] = [product, from, to]
    const positionParams: unknown[] = [product, from, to]
    const tradeAccountFilter    = buildAccountFilter(`UPPER(TRIM(${quoteIdent(ta)}::text))`, tradeParams)
    const positionAccountFilter = buildAccountFilter(`UPPER(TRIM(${quoteIdent(pa)}::text))`, positionParams)

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
         ${tradeAccountFilter}
         GROUP BY 1, 2 ORDER BY 1, 2`,
        tradeParams,
      ),
      query<PnlRow>(
        `SELECT (${quoteIdent(pd)}::date)::text AS date,
                ${upperTrimExpr(pa)}            AS account,
                SUM(${numericExpr(hp)})         AS pnl
         FROM ${positionTable}
         WHERE ${positionProductExpr}
           AND ${quoteIdent(pd)}::date BETWEEN $2::date AND $3::date
         ${positionAccountFilter}
         GROUP BY 1, 2 ORDER BY 1, 2`,
        positionParams,
      ),
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
         SELECT date, close, preclose FROM ranked WHERE rn = 1 AND close > 0 ORDER BY date`,
        [product, from, to],
      ).then(async (rows) => {
        const akCode = AKSHARE_CODE[product]
        if (!akCode) return rows
        const akRows = await query<BmRow>(
          `SELECT trade_date::text AS date, CAST(close AS float8) AS close,
                  COALESCE(CAST(close AS float8) / NULLIF(1 + CAST(pct_change AS float8) / 100, 0), CAST(close AS float8)) AS preclose
           FROM raw_akshare_futures_daily WHERE code = $1 AND trade_date BETWEEN $2 AND $3
             AND CAST(close AS float8) > 0 ORDER BY trade_date`,
          [akCode, from, to],
        ).catch(() => [] as BmRow[])
        if (akRows.length === 0) return rows
        if (rows.length === 0) return akRows
        const primaryDates = new Set(rows.map((r) => r.date))
        return [...rows, ...akRows.filter((r) => !primaryDates.has(r.date))].sort((a, b) =>
          a.date.localeCompare(b.date),
        )
      }).catch(() => [] as BmRow[]),
    ])

    const pnlMap = new Map<string, Map<string, number>>()
    for (const row of [...realizedRows, ...holdingRows]) {
      if (!pnlMap.has(row.account)) pnlMap.set(row.account, new Map())
      const dm = pnlMap.get(row.account)!
      dm.set(row.date, (dm.get(row.date) ?? 0) + Number(row.pnl || 0))
    }

    const accounts = [...pnlMap.keys()].sort()
    const series = accounts.map((acc) => {
      let cumPnl = 0
      const data = [...pnlMap.get(acc)!.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, pnl]) => {
          cumPnl += pnl
          return { date, pct: parseFloat(((cumPnl / INITIAL_CAPITAL) * 100).toFixed(3)) }
        })
      return { account: acc.toLowerCase(), data }
    })

    let bmCumPct = 0
    const benchmark = benchmarkRows.map((row) => {
      if (row.preclose && row.preclose !== 0) {
        bmCumPct += ((row.close - row.preclose) / row.preclose) * 100
      }
      return { date: row.date, pct: parseFloat(bmCumPct.toFixed(3)) }
    })

    return NextResponse.json({ ok: true, accounts, series, benchmark, ...advisorMeta })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true, accounts: [], series: [], benchmark: [],
        advisorSectors: [], advisorBackgrounds: [], advisorStyles: [], advisorCycles: [],
        advisorArbitrages: [], advisorStrengths: [], advisorRegions: [], notYetRun: true,
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("advisor-equity-curve", _GET)
