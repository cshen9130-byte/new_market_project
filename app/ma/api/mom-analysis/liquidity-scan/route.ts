import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── types ─────────────────────────────────────────────────────────────────────

export type LiquiditySeverity = "critical" | "warning" | "ok"

export interface ContractLiquidity {
  contract: string            // e.g. "RB2506"
  product: string             // e.g. "RB"
  exchange: string
  netLots: number             // total net lots held (long – short across all accounts)
  longLots: number
  shortLots: number
  positionMv: number          // total position market value (yuan)
  margin: number              // total margin occupied (yuan)
  volume: number | null       // daily volume (lots) from raw_futures_contracts_daily
  openInterest: number | null // open interest (lots)
  participationRate: number | null  // netLots / volume × 100 (%)
  oiConcentration: number | null    // netLots / openInterest × 100 (%)
  severity: LiquiditySeverity
  warnings: string[]
  dataDate: string            // date of position data
  mktDate: string | null      // date of market volume/OI data
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

function getProduct(contract: string): string {
  return (contract.match(/^[A-Z]+/i)?.[0] ?? contract).toUpperCase()
}

// Assess severity from computed metrics
function assessSeverity(
  netLots: number,
  volume: number | null,
  oi: number | null,
): { severity: LiquiditySeverity; warnings: string[] } {
  const warnings: string[] = []
  let maxLevel: 0 | 1 | 2 = 0 // 0=ok 1=warning 2=critical

  if (volume !== null && volume > 0) {
    const partRate = (netLots / volume) * 100
    if (partRate >= 15) {
      warnings.push(`成交量占比 ${partRate.toFixed(1)}%（危险阈值 15%）`)
      maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
    } else if (partRate >= 5) {
      warnings.push(`成交量占比 ${partRate.toFixed(1)}%（警示阈值 5%）`)
      maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
    }
  } else if (volume === 0) {
    warnings.push("当日成交量为 0，合约可能已停止交易")
    maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
  }

  if (oi !== null && oi > 0) {
    const oiConc = (netLots / oi) * 100
    if (oiConc >= 8) {
      warnings.push(`持仓量占比 ${oiConc.toFixed(1)}%（危险阈值 8%）`)
      maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
    } else if (oiConc >= 3) {
      warnings.push(`持仓量占比 ${oiConc.toFixed(1)}%（警示阈值 3%）`)
      maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
    }
  } else if (oi === 0) {
    warnings.push("合约持仓量为 0")
    maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
  }

  if (volume !== null && volume > 0 && volume < 200) {
    warnings.push(`市场总成交量极低（${volume} 手），流动性严重不足`)
    maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
  } else if (volume !== null && volume > 0 && volume < 1000) {
    warnings.push(`市场总成交量偏低（${volume} 手）`)
    maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  }

  const severity: LiquiditySeverity = maxLevel === 2 ? "critical" : maxLevel === 1 ? "warning" : "ok"
  return { severity, warnings }
}

// ── handler ───────────────────────────────────────────────────────────────────

async function _GET(_req: Request) {
  try {
    // ── 1. Get latest position date ───────────────────────────────────────────
    const dateRows = await query<{ date: string }>(
      `SELECT DISTINCT "交易日期"::date::text AS date
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL
       ORDER BY date DESC LIMIT 1`,
    )
    if (dateRows.length === 0) {
      return NextResponse.json({ ok: true, date: null, contracts: [], notYetRun: true })
    }
    const posDate = dateRows[0].date

    // ── 2. Aggregate net lots per contract from mom_position_details ──────────
    const numCol = (col: string) =>
      `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

    const posRows = await query<{
      contract: string
      exchange: string
      long_lots: string
      short_lots: string
      position_mv: string
      margin: string
    }>(
      `SELECT
         UPPER(TRIM("合约"))   AS contract,
         TRIM("交易所")        AS exchange,
         SUM(${numCol("买持仓")})::text     AS long_lots,
         SUM(${numCol("卖持仓")})::text     AS short_lots,
         SUM(${numCol("持仓市値")})::text   AS position_mv,
         SUM(${numCol("保证金")})::text     AS margin
       FROM mom_position_details
       WHERE "交易日期"::date = $1
         AND (${numCol("买持仓")} > 0 OR ${numCol("卖持仓")} > 0)
       GROUP BY UPPER(TRIM("合约")), TRIM("交易所")
       ORDER BY UPPER(TRIM("合约"))`,
      [posDate],
    )

    // ── 3. Merge guosen positions ─────────────────────────────────────────────
    const contractMap = new Map<string, {
      contract: string; exchange: string
      longLots: number; shortLots: number
      positionMv: number; margin: number
    }>()

    for (const r of posRows) {
      const key = r.contract
      const existing = contractMap.get(key)
      if (existing) {
        existing.longLots   += toNum(r.long_lots)
        existing.shortLots  += toNum(r.short_lots)
        existing.positionMv += toNum(r.position_mv)
        existing.margin     += toNum(r.margin)
      } else {
        contractMap.set(key, {
          contract: r.contract,
          exchange: r.exchange ?? "",
          longLots: toNum(r.long_lots),
          shortLots: toNum(r.short_lots),
          positionMv: toNum(r.position_mv),
          margin: toNum(r.margin),
        })
      }
    }

    try {
      const guosenRows = await query<{
        instrument: string; bs: string; position_lots: string
        settl_today: string; margin: string
      }>(
        `SELECT UPPER(TRIM(instrument)) AS instrument,
                bs,
                COALESCE(position_lots, 0)::text AS position_lots,
                COALESCE(settl_today,   0)::text AS settl_today,
                COALESCE(margin,        0)::text AS margin
         FROM guosen_position_detail
         WHERE settlement_date::date = $1
           AND COALESCE(position_lots, 0) > 0`,
        [posDate],
      )
      for (const r of guosenRows) {
        const lots = toNum(r.position_lots)
        const mv = lots * toNum(r.settl_today)
        const mg = toNum(r.margin)
        const isLong = r.bs === "买"
        const existing = contractMap.get(r.instrument)
        if (existing) {
          if (isLong) existing.longLots += lots; else existing.shortLots += lots
          existing.positionMv += mv
          existing.margin     += mg
        } else {
          contractMap.set(r.instrument, {
            contract: r.instrument,
            exchange: "",
            longLots: isLong ? lots : 0,
            shortLots: isLong ? 0 : lots,
            positionMv: mv,
            margin: mg,
          })
        }
      }
    } catch {
      // guosen_position_detail unavailable
    }

    // ── 4. Get volume/OI from raw_futures_contracts_daily ────────────────────
    const contracts = [...contractMap.keys()]
    if (contracts.length === 0) {
      return NextResponse.json({ ok: true, date: posDate, contracts: [], notYetRun: false })
    }

    // Get latest market data date (may differ from position date on weekends / late updates)
    const mktDateRows = await query<{ date: string }>(
      `SELECT trade_date::date::text AS date
       FROM raw_futures_contracts_daily
       ORDER BY trade_date DESC LIMIT 1`,
    ).catch(() => [] as { date: string }[])
    const mktDate = mktDateRows[0]?.date ?? null

    // Fetch volume and OI for all held contracts (use latest 1 day of data).
    // Handles both plain codes ("LC2702", from AkShare) and suffixed codes
    // ("LC2702.GFE", from EmQuant/Choice) by stripping the exchange suffix
    // before matching.  Prefer the row with higher volume when duplicates exist.
    const mktRows = await query<{
      contract: string
      volume: string | null
      hqoi: string | null
      trade_date: string
    }>(
      `SELECT UPPER(SPLIT_PART(TRIM(contract), '.', 1)) AS contract,
              MAX(volume)::text            AS volume,
              MAX(hqoi)::text              AS hqoi,
              MAX(trade_date)::date::text  AS trade_date
       FROM raw_futures_contracts_daily
       WHERE UPPER(SPLIT_PART(TRIM(contract), '.', 1)) = ANY($1)
         AND trade_date = (SELECT MAX(trade_date) FROM raw_futures_contracts_daily)
       GROUP BY UPPER(SPLIT_PART(TRIM(contract), '.', 1))`,
      [contracts],
    ).catch(() => [] as { contract: string; volume: string | null; hqoi: string | null; trade_date: string }[])

    const mktMap = new Map<string, { volume: number | null; hqoi: number | null; trade_date: string }>()
    for (const r of mktRows) {
      mktMap.set(r.contract, {
        volume: r.volume !== null ? toNum(r.volume) : null,
        hqoi:   r.hqoi   !== null ? toNum(r.hqoi)   : null,
        trade_date: r.trade_date,
      })
    }

    // ── 5. Build result ───────────────────────────────────────────────────────
    const result: ContractLiquidity[] = []

    for (const [contract, pos] of contractMap.entries()) {
      // skip options (contain C/P + strike)
      if (/^[A-Z]+\d+-?[CP]-?\d+$/i.test(contract)) continue

      const mkt = mktMap.get(contract) ?? null
      const netLots = Math.abs(pos.longLots - pos.shortLots) || Math.max(pos.longLots, pos.shortLots)
      const volume = mkt?.volume ?? null
      const oi     = mkt?.hqoi   ?? null

      const participationRate = (volume !== null && volume > 0) ? (netLots / volume) * 100 : null
      const oiConcentration   = (oi     !== null && oi     > 0) ? (netLots / oi)     * 100 : null

      const { severity, warnings } = assessSeverity(netLots, volume, oi)

      result.push({
        contract,
        product: getProduct(contract),
        exchange: pos.exchange,
        netLots,
        longLots: Math.round(pos.longLots),
        shortLots: Math.round(pos.shortLots),
        positionMv: Math.round(pos.positionMv),
        margin: Math.round(pos.margin),
        volume,
        openInterest: oi,
        participationRate: participationRate !== null ? Math.round(participationRate * 100) / 100 : null,
        oiConcentration:   oiConcentration   !== null ? Math.round(oiConcentration   * 100) / 100 : null,
        severity,
        warnings,
        dataDate: posDate,
        mktDate: mkt?.trade_date ?? mktDate,
      })
    }

    // Sort: critical first, then warning, then ok; within each group sort by participationRate desc
    result.sort((a, b) => {
      const sOrder = { critical: 0, warning: 1, ok: 2 }
      const sd = sOrder[a.severity] - sOrder[b.severity]
      if (sd !== 0) return sd
      return (b.participationRate ?? 0) - (a.participationRate ?? 0)
    })

    const summary = {
      total: result.length,
      critical: result.filter((c) => c.severity === "critical").length,
      warning:  result.filter((c) => c.severity === "warning").length,
      ok:       result.filter((c) => c.severity === "ok").length,
      noMktData: result.filter((c) => c.volume === null).length,
    }

    return NextResponse.json({ ok: true, date: posDate, mktDate, contracts: result, summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_position_details") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, date: null, contracts: [], summary: null, notYetRun: true })
    }
    console.error("[liquidity-scan]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("liquidity-scan", _GET)
