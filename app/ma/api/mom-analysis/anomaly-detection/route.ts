import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── types ────────────────────────────────────────────────────────────────────

export type AnomalySeverity = "critical" | "warning" | "info"

export interface Anomaly {
  id: string
  date: string
  account: string | null
  type: string
  severity: AnomalySeverity
  title: string
  detail: string
  value: number | null
  threshold: number | null
  unit?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? null : n
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return "—"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ── anomaly checks ────────────────────────────────────────────────────────────

interface AccountRow {
  account: string
  date: string
  risk_ratio: string | null
  margin: string | null
  equity: string | null
  available: string | null
  daily_pnl: string | null
}

function checkAccountAnomalies(
  date: string,
  rows: AccountRow[],
  prevEquityByAccount: Record<string, number>,
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const row of rows) {
    const riskRatio = parseNum(row.risk_ratio)
    const equity = parseNum(row.equity)
    const available = parseNum(row.available)
    const margin = parseNum(row.margin)
    const dailyPnl = parseNum(row.daily_pnl)

    // 1. High risk ratio
    if (riskRatio !== null && riskRatio > 90) {
      anomalies.push({
        id: `${date}_${row.account}_HIGH_RISK_CRITICAL`,
        date,
        account: row.account,
        type: "HIGH_RISK_RATIO",
        severity: "critical",
        title: "风险度极高",
        detail: `账户 ${row.account} 风险度达 ${fmt(riskRatio, 1)}%，超过危险阈值 90%`,
        value: riskRatio,
        threshold: 90,
        unit: "%",
      })
    } else if (riskRatio !== null && riskRatio > 70) {
      anomalies.push({
        id: `${date}_${row.account}_HIGH_RISK_WARNING`,
        date,
        account: row.account,
        type: "HIGH_RISK_RATIO",
        severity: "warning",
        title: "风险度偏高",
        detail: `账户 ${row.account} 风险度达 ${fmt(riskRatio, 1)}%，超过警示阈值 70%`,
        value: riskRatio,
        threshold: 70,
        unit: "%",
      })
    }

    // 2. Low available funds ratio
    if (equity !== null && equity > 0 && available !== null) {
      const availableRatio = (available / equity) * 100
      if (availableRatio < 5) {
        anomalies.push({
          id: `${date}_${row.account}_LOW_AVAIL_CRITICAL`,
          date,
          account: row.account,
          type: "LOW_AVAILABLE_FUNDS",
          severity: "critical",
          title: "可用资金严重不足",
          detail: `账户 ${row.account} 可用资金占权益比 ${fmt(availableRatio, 1)}%，低于危险阈值 5%`,
          value: availableRatio,
          threshold: 5,
          unit: "%",
        })
      } else if (availableRatio < 15) {
        anomalies.push({
          id: `${date}_${row.account}_LOW_AVAIL_WARNING`,
          date,
          account: row.account,
          type: "LOW_AVAILABLE_FUNDS",
          severity: "warning",
          title: "可用资金不足",
          detail: `账户 ${row.account} 可用资金占权益比 ${fmt(availableRatio, 1)}%，低于警示阈值 15%`,
          value: availableRatio,
          threshold: 15,
          unit: "%",
        })
      }
    }

    // 3. Margin overuse
    if (equity !== null && equity > 0 && margin !== null) {
      const marginRatio = (margin / equity) * 100
      if (marginRatio > 90) {
        anomalies.push({
          id: `${date}_${row.account}_MARGIN_OVERUSE_CRITICAL`,
          date,
          account: row.account,
          type: "MARGIN_OVERUSE",
          severity: "critical",
          title: "保证金占用过高",
          detail: `账户 ${row.account} 保证金占权益比 ${fmt(marginRatio, 1)}%，超过危险阈值 90%`,
          value: marginRatio,
          threshold: 90,
          unit: "%",
        })
      } else if (marginRatio > 80) {
        anomalies.push({
          id: `${date}_${row.account}_MARGIN_OVERUSE_WARNING`,
          date,
          account: row.account,
          type: "MARGIN_OVERUSE",
          severity: "warning",
          title: "保证金占用偏高",
          detail: `账户 ${row.account} 保证金占权益比 ${fmt(marginRatio, 1)}%，超过警示阈值 80%`,
          value: marginRatio,
          threshold: 80,
          unit: "%",
        })
      }
    }

    // 4. Large daily loss (relative to previous day equity)
    if (dailyPnl !== null && dailyPnl < 0) {
      const prevEquity = prevEquityByAccount[row.account]
      const base = prevEquity ?? equity
      if (base && base > 0) {
        const lossRatio = (dailyPnl / base) * 100
        if (lossRatio < -3) {
          anomalies.push({
            id: `${date}_${row.account}_LARGE_LOSS_CRITICAL`,
            date,
            account: row.account,
            type: "LARGE_DAILY_LOSS",
            severity: "critical",
            title: "当日大幅亏损",
            detail: `账户 ${row.account} 当日亏损 ${fmt(Math.abs(dailyPnl))} 元，占权益比 ${fmt(Math.abs(lossRatio), 2)}%，超过危险阈值 3%`,
            value: lossRatio,
            threshold: -3,
            unit: "%",
          })
        } else if (lossRatio < -1.5) {
          anomalies.push({
            id: `${date}_${row.account}_LARGE_LOSS_WARNING`,
            date,
            account: row.account,
            type: "LARGE_DAILY_LOSS",
            severity: "warning",
            title: "当日亏损偏大",
            detail: `账户 ${row.account} 当日亏损 ${fmt(Math.abs(dailyPnl))} 元，占权益比 ${fmt(Math.abs(lossRatio), 2)}%，超过警示阈值 1.5%`,
            value: lossRatio,
            threshold: -1.5,
            unit: "%",
          })
        }
      }
    }

    // 5. Negative equity
    if (equity !== null && equity < 0) {
      anomalies.push({
        id: `${date}_${row.account}_NEGATIVE_EQUITY`,
        date,
        account: row.account,
        type: "NEGATIVE_EQUITY",
        severity: "critical",
        title: "账户权益为负",
        detail: `账户 ${row.account} 客户权益为 ${fmt(equity)} 元`,
        value: equity,
        threshold: 0,
        unit: "元",
      })
    }
  }

  return anomalies
}

// ── main handler ─────────────────────────────────────────────────────────────

async function _GET(req: Request) {
  const url = new URL(req.url)
  // Optional: lookback days for history (default 30)
  const lookbackDays = Math.min(parseInt(url.searchParams.get("lookback") ?? "30", 10), 90)

  try {
    const numExpr = (col: string) =>
      `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}", ''), ',', ''), ' ', ''), '')::numeric, 0)`

    const rows = await query<{
      account: string
      date: string
      risk_ratio: string | null
      margin: string | null
      equity: string | null
      available: string | null
      daily_pnl: string | null
    }>(
      `SELECT
         "账户" AS account,
         "交易日期"::text AS date,
         (NULLIF(REPLACE(REPLACE(REPLACE(COALESCE("风险度", ''), ',', ''), ' ', ''), '%', ''), ''))::text AS risk_ratio,
         (NULLIF(REPLACE(REPLACE(COALESCE("保证金占用", ''), ',', ''), ' ', ''), ''))::text AS margin,
         (NULLIF(REPLACE(REPLACE(COALESCE("客户权益",   ''), ',', ''), ' ', ''), ''))::text AS equity,
         (NULLIF(REPLACE(REPLACE(COALESCE("可用资金",   ''), ',', ''), ' ', ''), ''))::text AS available,
         (
           ${numExpr("当日盈亏")}
           - ${numExpr("当日手续费")}
           + ${numExpr("权利金收入")}
           - ${numExpr("权利金支出")}
         )::text AS daily_pnl
       FROM mom_daily_reports
       WHERE "交易日期"::date >= CURRENT_DATE - INTERVAL '${lookbackDays + 1} days'
       ORDER BY "交易日期", "账户"`,
    )

    // Group rows by date
    const byDate: Record<string, AccountRow[]> = {}
    for (const row of rows) {
      if (!byDate[row.date]) byDate[row.date] = []
      byDate[row.date].push(row)
    }

    const sortedDates = Object.keys(byDate).sort()

    // Run anomaly checks per date
    const allAnomalies: Anomaly[] = []
    const dailySummary: Array<{
      date: string
      critical: number
      warning: number
      info: number
      total: number
    }> = []

    // Track previous day equity per account for loss ratio calculation
    const prevEquityByAccount: Record<string, number> = {}

    for (const date of sortedDates) {
      const dayRows = byDate[date]
      const dayAnomalies = checkAccountAnomalies(date, dayRows, prevEquityByAccount)
      allAnomalies.push(...dayAnomalies)

      // Update prev equity
      for (const row of dayRows) {
        const eq = parseNum(row.equity)
        if (eq !== null) prevEquityByAccount[row.account] = eq
      }

      dailySummary.push({
        date,
        critical: dayAnomalies.filter((a) => a.severity === "critical").length,
        warning: dayAnomalies.filter((a) => a.severity === "warning").length,
        info: dayAnomalies.filter((a) => a.severity === "info").length,
        total: dayAnomalies.length,
      })
    }

    const latestDate = sortedDates[sortedDates.length - 1] ?? null

    return NextResponse.json({
      ok: true,
      latestDate,
      anomalies: allAnomalies,
      dailySummary,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, latestDate: null, anomalies: [], dailySummary: [], notYetRun: true })
    }
    console.error("[anomaly-detection]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("anomaly-detection", _GET)
