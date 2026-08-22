/**
 * Account-level anomaly checks for 单账户 (cfmmc_daily_summary only).
 */
import { publicQuery } from "@/lib/db"
import { scopeWhere } from "@/lib/server/account-risk-scope"
import { toNum } from "@/lib/server/account-risk-classify"

export type AnomalySeverity = "critical" | "warning" | "info"

export interface AccountAnomaly {
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

export interface AnomalyDaySummary {
  date: string
  critical: number
  warning: number
  info: number
  total: number
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return "—"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function asRiskPct(raw: number | null, margin: number, equity: number): number | null {
  if (raw != null) return raw <= 1 ? raw * 100 : raw
  return equity > 0 ? (margin / equity) * 100 : null
}

function checkAccountAnomalies(
  date: string,
  rows: { account: string; riskPct: number | null; equity: number; available: number; margin: number; dailyPnl: number | null }[],
  prevEquityByAccount: Record<string, number>,
): AccountAnomaly[] {
  const anomalies: AccountAnomaly[] = []

  for (const row of rows) {
    const { account, riskPct, equity, available, margin, dailyPnl } = row

    if (riskPct !== null && riskPct > 90) {
      anomalies.push({
        id: `${date}_${account}_HIGH_RISK_CRITICAL`,
        date, account, type: "HIGH_RISK_RATIO", severity: "critical",
        title: "风险度极高",
        detail: `账户 ${account} 风险度达 ${fmt(riskPct, 1)}%，超过危险阈值 90%`,
        value: riskPct, threshold: 90, unit: "%",
      })
    } else if (riskPct !== null && riskPct > 70) {
      anomalies.push({
        id: `${date}_${account}_HIGH_RISK_WARNING`,
        date, account, type: "HIGH_RISK_RATIO", severity: "warning",
        title: "风险度偏高",
        detail: `账户 ${account} 风险度达 ${fmt(riskPct, 1)}%，超过警示阈值 70%`,
        value: riskPct, threshold: 70, unit: "%",
      })
    }

    if (equity > 0) {
      const availableRatio = (available / equity) * 100
      if (availableRatio < 5) {
        anomalies.push({
          id: `${date}_${account}_LOW_AVAIL_CRITICAL`,
          date, account, type: "LOW_AVAILABLE_FUNDS", severity: "critical",
          title: "可用资金严重不足",
          detail: `账户 ${account} 可用资金占权益比 ${fmt(availableRatio, 1)}%，低于危险阈值 5%`,
          value: availableRatio, threshold: 5, unit: "%",
        })
      } else if (availableRatio < 15) {
        anomalies.push({
          id: `${date}_${account}_LOW_AVAIL_WARNING`,
          date, account, type: "LOW_AVAILABLE_FUNDS", severity: "warning",
          title: "可用资金不足",
          detail: `账户 ${account} 可用资金占权益比 ${fmt(availableRatio, 1)}%，低于警示阈值 15%`,
          value: availableRatio, threshold: 15, unit: "%",
        })
      }

      const marginRatio = (margin / equity) * 100
      if (marginRatio > 90) {
        anomalies.push({
          id: `${date}_${account}_MARGIN_OVERUSE_CRITICAL`,
          date, account, type: "MARGIN_OVERUSE", severity: "critical",
          title: "保证金占用过高",
          detail: `账户 ${account} 保证金占权益比 ${fmt(marginRatio, 1)}%，超过危险阈值 90%`,
          value: marginRatio, threshold: 90, unit: "%",
        })
      } else if (marginRatio > 80) {
        anomalies.push({
          id: `${date}_${account}_MARGIN_OVERUSE_WARNING`,
          date, account, type: "MARGIN_OVERUSE", severity: "warning",
          title: "保证金占用偏高",
          detail: `账户 ${account} 保证金占权益比 ${fmt(marginRatio, 1)}%，超过警示阈值 80%`,
          value: marginRatio, threshold: 80, unit: "%",
        })
      }
    }

    const prevEquity = prevEquityByAccount[account]
    if (dailyPnl != null && dailyPnl < 0 && prevEquity > 0) {
      const lossRatio = (dailyPnl / prevEquity) * 100
      if (lossRatio < -3) {
        anomalies.push({
          id: `${date}_${account}_LARGE_LOSS_CRITICAL`,
          date, account, type: "LARGE_DAILY_LOSS", severity: "critical",
          title: "当日大幅亏损",
          detail: `账户 ${account} 当日亏损 ${fmt(Math.abs(dailyPnl))} 元，占权益比 ${fmt(Math.abs(lossRatio), 2)}%，超过危险阈值 3%`,
          value: lossRatio, threshold: -3, unit: "%",
        })
      } else if (lossRatio < -1.5) {
        anomalies.push({
          id: `${date}_${account}_LARGE_LOSS_WARNING`,
          date, account, type: "LARGE_DAILY_LOSS", severity: "warning",
          title: "当日亏损偏大",
          detail: `账户 ${account} 当日亏损 ${fmt(Math.abs(dailyPnl))} 元，占权益比 ${fmt(Math.abs(lossRatio), 2)}%，超过警示阈值 1.5%`,
          value: lossRatio, threshold: -1.5, unit: "%",
        })
      }
    }

    if (equity < 0) {
      anomalies.push({
        id: `${date}_${account}_NEGATIVE_EQUITY`,
        date, account, type: "NEGATIVE_EQUITY", severity: "critical",
        title: "账户权益为负",
        detail: `账户 ${account} 客户权益为 ${fmt(equity)} 元`,
        value: equity, threshold: 0, unit: "元",
      })
    }
  }

  return anomalies
}

export async function buildAccountAnomalyPayload(lookbackDays: number): Promise<{
  ok: true
  latestDate: string | null
  anomalies: AccountAnomaly[]
  dailySummary: AnomalyDaySummary[]
  notYetRun?: true
}> {
  const params: unknown[] = [lookbackDays + 1]
  const scoped = scopeWhere(params)
  const result = await publicQuery(`
    SELECT account_no AS account,
           trade_date::text AS date,
           risk_ratio,
           margin_occupied AS margin,
           client_equity AS equity,
           available,
           daily_pnl
    FROM public.cfmmc_daily_summary
    WHERE trade_date >= (SELECT MAX(trade_date) - ($1 * INTERVAL '1 day') FROM public.cfmmc_daily_summary WHERE ${scoped})
      AND ${scoped}
    ORDER BY trade_date, account_no
  `, params)

  if (result.rows.length === 0) {
    return { ok: true, latestDate: null, anomalies: [], dailySummary: [], notYetRun: true }
  }

  type Row = {
    account: string
    date: string
    risk_ratio: number | string | null
    margin: number | string | null
    equity: number | string | null
    available: number | string | null
    daily_pnl: number | string | null
  }

  const byDate: Record<string, Row[]> = {}
  for (const row of result.rows as Row[]) {
    if (!byDate[row.date]) byDate[row.date] = []
    byDate[row.date].push(row)
  }

  const sortedDates = Object.keys(byDate).sort()
  const allAnomalies: AccountAnomaly[] = []
  const dailySummary: AnomalyDaySummary[] = []
  const prevEquityByAccount: Record<string, number> = {}

  for (const date of sortedDates) {
    const dayRows = byDate[date].map((row) => {
      const equity = toNum(row.equity)
      const margin = toNum(row.margin)
      return {
        account: row.account,
        riskPct: asRiskPct(row.risk_ratio == null ? null : toNum(row.risk_ratio), margin, equity),
        equity,
        available: toNum(row.available),
        margin,
        dailyPnl: row.daily_pnl == null ? null : toNum(row.daily_pnl),
      }
    })
    const dayAnomalies = checkAccountAnomalies(date, dayRows, prevEquityByAccount)
    allAnomalies.push(...dayAnomalies)
    for (const row of dayRows) prevEquityByAccount[row.account] = row.equity
    dailySummary.push({
      date,
      critical: dayAnomalies.filter((a) => a.severity === "critical").length,
      warning: dayAnomalies.filter((a) => a.severity === "warning").length,
      info: dayAnomalies.filter((a) => a.severity === "info").length,
      total: dayAnomalies.length,
    })
  }

  return {
    ok: true,
    latestDate: sortedDates[sortedDates.length - 1] ?? null,
    anomalies: allAnomalies,
    dailySummary,
  }
}
