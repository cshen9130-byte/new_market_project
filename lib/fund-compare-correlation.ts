import type { NavPoint } from "@/lib/fund-compare-period-returns"

export interface CorrelationColumn {
  key: string
  label: string
}

export interface CorrelationCell {
  key: string
  label: string
  value: number | null
}

export interface CorrelationRow {
  key: string
  name: string
  cells: CorrelationCell[]
}

const INTERVAL_DEFS = [
  { key: "1m", label: "近一月", days: 30 },
  { key: "3m", label: "近三月", days: 90 },
  { key: "6m", label: "近六月", days: 182 },
  { key: "1y", label: "近一年", days: 365 },
  { key: "2y", label: "近两年", days: 730 },
  { key: "3y", label: "近三年", days: 1095 },
  { key: "5y", label: "近五年", days: 1825 },
  { key: "ytd", label: "今年以来", special: "ytd" as const },
  { key: "si", label: "成立以来", special: "inception" as const },
]

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  return Number.isFinite(new Date(`${dateStr}T12:00:00`).getTime())
}

function subDays(dateStr: string, days: number): string {
  const base = isValidDateStr(dateStr) ? dateStr : isoToday()
  const d = new Date(`${base}T12:00:00`)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function pearsonCorrelation(fundRets: number[], benchRets: number[]): number | null {
  if (fundRets.length < 3 || fundRets.length !== benchRets.length) return null
  const n = fundRets.length
  const mf = fundRets.reduce((s, v) => s + v, 0) / n
  const mb = benchRets.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let vf = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const df = fundRets[i] - mf
    const db = benchRets[i] - mb
    cov += df * db
    vf += df * df
    vb += db * db
  }
  const den = Math.sqrt(vf * vb)
  return den > 0 ? cov / den : null
}

function alignedNavPairs(fundPoints: NavPoint[], benchPoints: NavPoint[]): Array<{ fund: number; bench: number }> {
  const fundSorted = [...fundPoints].sort((a, b) => a.d.localeCompare(b.d))
  const benchSorted = [...benchPoints].sort((a, b) => a.d.localeCompare(b.d))
  let benchIdx = 0
  let lastBench: number | null = null
  const pairs: Array<{ fund: number; bench: number }> = []

  for (const fp of fundSorted) {
    while (benchIdx < benchSorted.length && benchSorted[benchIdx].d <= fp.d) {
      lastBench = benchSorted[benchIdx].v
      benchIdx += 1
    }
    if (lastBench != null && lastBench > 0 && fp.v > 0) {
      pairs.push({ fund: fp.v, bench: lastBench })
    }
  }
  return pairs
}

export function computeNavReturnCorrelation(
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
  from: string,
  to: string,
): number | null {
  const fundSlice = fundPoints.filter((p) => p.d >= from && p.d <= to)
  const pairs = alignedNavPairs(fundSlice, benchPoints)
  if (pairs.length < 4) return null

  const fundRets: number[] = []
  const benchRets: number[] = []
  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1]
    const curr = pairs[i]
    if (prev.fund <= 0 || curr.fund <= 0 || prev.bench <= 0 || curr.bench <= 0) continue
    fundRets.push(curr.fund / prev.fund - 1)
    benchRets.push(curr.bench / prev.bench - 1)
  }

  return pearsonCorrelation(fundRets, benchRets)
}

export function intervalCorrelationColumns(cutoffDate: string): CorrelationColumn[] {
  return INTERVAL_DEFS.map((d) => ({ key: d.key, label: d.label }))
}

export function computeIntervalCorrelationCells(
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
  cutoffDate: string,
): CorrelationCell[] {
  const effectiveCutoff = isValidDateStr(cutoffDate) ? cutoffDate : isoToday()
  if (!fundPoints.length) {
    return INTERVAL_DEFS.map((d) => ({ key: d.key, label: d.label, value: null }))
  }

  const inception = fundPoints[0].d.slice(0, 10)
  return INTERVAL_DEFS.map((def) => {
    let from = inception
    if (def.special === "ytd") from = `${effectiveCutoff.slice(0, 4)}-01-01`
    else if (def.special === "inception") from = inception
    else from = subDays(effectiveCutoff, def.days!)

    return {
      key: def.key,
      label: def.label,
      value: computeNavReturnCorrelation(fundPoints, benchPoints, from, effectiveCutoff),
    }
  })
}

export function annualCorrelationColumns(fundPoints: NavPoint[]): CorrelationColumn[] {
  const years = [...new Set(fundPoints.map((p) => p.d.slice(0, 4)))].sort()
  return years.map((year) => ({ key: year, label: `${year}年` }))
}

export function computeAnnualCorrelationCells(
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
): CorrelationCell[] {
  const years = [...new Set(fundPoints.map((p) => p.d.slice(0, 4)))].sort()
  return years.map((year) => {
    const from = `${year}-01-01`
    const to = `${year}-12-31`
    return {
      key: year,
      label: `${year}年`,
      value: computeNavReturnCorrelation(fundPoints, benchPoints, from, to),
    }
  })
}

export function buildFundCorrelationRow(
  key: string,
  name: string,
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
  mode: "interval" | "annual",
  cutoffDate: string,
): CorrelationRow {
  const cells = mode === "interval"
    ? computeIntervalCorrelationCells(fundPoints, benchPoints, cutoffDate)
    : computeAnnualCorrelationCells(fundPoints, benchPoints)
  return { key, name, cells }
}

export function correlationCellStyle(corr: number | null): { backgroundColor: string; color: string } {
  if (corr === null || !Number.isFinite(corr)) {
    return { backgroundColor: "#fafafa", color: "#a1a1aa" }
  }
  const intensity = Math.max(0, Math.min(1, Math.abs(corr)))
  const alpha = 0.12 + intensity * 0.5
  return {
    backgroundColor: `rgba(239, 68, 68, ${alpha})`,
    color: intensity > 0.35 ? "#991b1b" : "#52525b",
  }
}

export function fmtCorrelation(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(4)
}
