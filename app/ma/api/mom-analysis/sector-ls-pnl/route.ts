import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getPrefix(contract: string): string {
  return (contract.match(/^[A-Z]+/i)?.[0] ?? contract).toUpperCase()
}

const SECTOR_MAP: Record<string, string> = {
  C:"农产",CS:"农产",WH:"农产",PM:"农产",RR:"农产",RI:"农产",JR:"农产",LR:"农产",
  A:"农产",B:"农产",M:"农产",Y:"农产",RM:"农产",OI:"农产",RS:"农产",PK:"农产",P:"农产",
  SR:"农产",CF:"农产",CY:"农产",LG:"农产",SP:"农产",OP:"农产",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"黑色",SF:"黑色",SM:"黑色",RB:"黑色",HC:"黑色",SS:"黑色",WR:"黑色",
  JM:"黑色",J:"黑色",ZC:"黑色",FG:"黑色",BB:"黑色",FB:"黑色",
  SC:"能源化工",FU:"能源化工",LU:"能源化工",PG:"能源化工",BU:"能源化工",
  TA:"能源化工",EG:"能源化工",PF:"能源化工",PR:"能源化工",PL:"能源化工",PP:"能源化工",L:"能源化工",
  BZ:"能源化工",PX:"能源化工",EB:"能源化工",
  RU:"能源化工",BR:"能源化工",NR:"能源化工",
  SA:"能源化工",SH:"能源化工",V:"能源化工",UR:"能源化工",MA:"能源化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}

function getSector(contract: string): string {
  return SECTOR_MAP[getPrefix(contract)] ?? "其他"
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

export async function GET() {
  try {
    // Find the latest trading date
    const latestRows = await query<{ latest_date: string }>(
      `SELECT MAX("交易日期"::date)::text AS latest_date FROM mom_futures_trade_details`
    )
    const latestDate = latestRows[0]?.latest_date
    if (!latestDate) {
      return NextResponse.json({ ok: true, sectorLS: [], latestDate: null })
    }

    // ── 1. 平仓盈亏 from mom_futures_trade_details, split by 买/卖 direction
    // '卖' = selling to close a long  → long PnL
    // '买' = buying to close a short  → short PnL
    const closeRows = await query<{ contract: string; direction: string; pnl: string }>(
      `SELECT
         UPPER(TRIM("合约")) AS contract,
         TRIM("买/卖")        AS direction,
         SUM(${numExpr("平仓盈亏")})::text AS pnl
       FROM mom_futures_trade_details
       WHERE "交易日期"::date = $1
         AND "合约" IS NOT NULL
       GROUP BY UPPER(TRIM("合约")), TRIM("买/卖")`,
      [latestDate],
    )

    // ── 2. 持仓盈亏 from mom_position_details, split by 买持仓 / 卖持仓
    // 买持仓 > 0  → long position  → long PnL
    // 卖持仓 > 0  → short position → short PnL
    const posRows = await query<{ contract: string; direction: string; pnl: string }>(
      `SELECT
         UPPER(TRIM("合约")) AS contract,
         CASE
           WHEN ${numExpr("买持仓")} > 0 THEN '买'
           ELSE '卖'
         END AS direction,
         SUM(${numExpr("持仓盈亏")})::text AS pnl
       FROM mom_position_details
       WHERE "交易日期"::date = $1
         AND "合约" IS NOT NULL
       GROUP BY UPPER(TRIM("合约")),
         CASE WHEN ${numExpr("买持仓")} > 0 THEN '买' ELSE '卖' END`,
      [latestDate],
    )

    // ── 3. -手续费 + 权利金收支 from mom_trade_details, split by 买/卖 direction
    let feeRows: { contract: string; direction: string; fee: string; premium: string }[] = []
    try {
      feeRows = await query<{ contract: string; direction: string; fee: string; premium: string }>(
        `SELECT
           UPPER(TRIM("合约")) AS contract,
           TRIM("买/卖")        AS direction,
           SUM(${numExpr("手续费")})::text     AS fee,
           SUM(${numExpr("权利金收支")})::text AS premium
         FROM mom_trade_details
         WHERE trade_date::date = $1
           AND "合约" IS NOT NULL
         GROUP BY UPPER(TRIM("合约")), TRIM("买/卖")`,
        [latestDate],
      )
    } catch { feeRows = [] }

    // ── Aggregate per sector × direction AND per product × direction
    const longMap = new Map<string, number>()
    const shortMap = new Map<string, number>()
    const prodLongMap = new Map<string, number>()
    const prodShortMap = new Map<string, number>()

    const add = (contract: string, side: "long" | "short", amount: number) => {
      const sector = getSector(contract)
      const prod = getPrefix(contract)
      if (side === "long") {
        longMap.set(sector, (longMap.get(sector) ?? 0) + amount)
        prodLongMap.set(prod, (prodLongMap.get(prod) ?? 0) + amount)
      } else {
        shortMap.set(sector, (shortMap.get(sector) ?? 0) + amount)
        prodShortMap.set(prod, (prodShortMap.get(prod) ?? 0) + amount)
      }
    }

    for (const row of closeRows) {
      const pnl = toNum(row.pnl)
      const dir = row.direction?.trim()
      if (dir === "卖") add(row.contract, "long", pnl)
      else if (dir === "买") add(row.contract, "short", pnl)
    }

    for (const row of posRows) {
      const pnl = toNum(row.pnl)
      const dir = row.direction?.trim()
      if (dir === "买") add(row.contract, "long", pnl)
      else add(row.contract, "short", pnl)
    }

    for (const row of feeRows) {
      const net = -toNum(row.fee) + toNum(row.premium)
      const dir = row.direction?.trim()
      if (dir === "卖") add(row.contract, "long", net)
      else if (dir === "买") add(row.contract, "short", net)
    }

    // Merge into sorted lists
    const allSectors = new Set([...longMap.keys(), ...shortMap.keys()])
    const sectorLS = [...allSectors]
      .map((sector) => ({
        sector,
        long: Math.round(longMap.get(sector) ?? 0),
        short: Math.round(shortMap.get(sector) ?? 0),
      }))
      .filter((s) => s.long !== 0 || s.short !== 0)
      .sort((a, b) => (b.long + b.short) - (a.long + a.short))

    const allProds = new Set([...prodLongMap.keys(), ...prodShortMap.keys()])
    const productLS = [...allProds]
      .map((prod) => ({
        prod,
        long: Math.round(prodLongMap.get(prod) ?? 0),
        short: Math.round(prodShortMap.get(prod) ?? 0),
      }))
      .filter((p) => p.long !== 0 || p.short !== 0)
      .sort((a, b) => (b.long + b.short) - (a.long + a.short))

    return NextResponse.json({ ok: true, sectorLS, productLS, latestDate })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_futures_trade_details") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, sectorLS: [], latestDate: null, notYetRun: true })
    }
    console.error("[sector-ls-pnl]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
