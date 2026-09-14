import raw from "./fomc-cpi-data.json"

export type Era = "all" | "hike" | "ease" | "now"
export type Action = "Hike" | "Hold" | "Cut" | "Pending"
export type ChartRange = "from2000" | "since10" | "since22" | "recent"
export type FedwatchRange = "month" | "meeting" | "qtr" | "ytd" | "since25" | "since22"

export type FedwatchPoint = {
  date: string
  label: string
  hike: number
  note: string
}

export type Meeting = {
  decision: string
  label: string
  era: Exclude<Era, "all">
  action: Action
  bps: number | null
  fundsHi: number | null
  cpiMonth: string
  cpiRelease: string
  actual: number
  forecast: number
  note?: string
}

export type MonthlyCpi = {
  ym: string
  label: string
  released: string
  actual: number
  forecast: number | null
  mom: number | null
  core: number | null
}

export const MEETINGS = raw.MEETINGS as Meeting[]
export const MONTHLY = raw.MONTHLY as MonthlyCpi[]
export const HIST_FOMC = raw.HIST_FOMC as Meeting[]
export const CORE_YOY = raw.CORE_YOY as Record<string, number>
export const CORE_PCE_YOY = raw.CORE_PCE_YOY as Record<string, number>
export const SEP_HIKE_ODDS = raw.SEP_HIKE_ODDS as FedwatchPoint[]

export const FEDWATCH_RANGE_LABEL: Record<FedwatchRange, string> = {
  month: "近 1 个月",
  meeting: "本次会议",
  qtr: "近 3 个月",
  ytd: "今年",
  since25: "2025 以来",
  since22: "2022 以来",
}

export const CORE_MOM_2026 = raw.CORE_MOM_2026 as { m: string; actual: number }[]
export const NFP_2026 = raw.NFP_2026 as { m: string; k: number }[]
export const AUG_CPI_PARTS = raw.AUG_CPI_PARTS as { name: string; v: number }[]
export const UNRATE = raw.UNRATE as Record<string, number>
export const U6RATE = raw.U6RATE as Record<string, number>
export const CIVPART = raw.CIVPART as Record<string, number>
export const SAHM = raw.SAHM as Record<string, number>

export const ERA_LABEL: Record<Era, string> = {
  all: "全部会议",
  hike: "加息周期 2022–23",
  ease: "暂停与降息 2024–25",
  now: "2026 按兵不动",
}

export const RANGE_LABEL: Record<ChartRange, string> = {
  from2000: "2000–至今",
  since10: "2010 以来",
  since22: "2022 以来",
  recent: "2025–2026",
}

export const ACTION_LABEL: Record<Action, string> = {
  Hike: "加息",
  Hold: "按兵不动",
  Cut: "降息",
  Pending: "待决议",
}

export const ACTION_COLOR: Record<Action, string> = {
  Hike: "#C44E52",
  Hold: "#8C8C8C",
  Cut: "#55A868",
  Pending: "#DD8452",
}

export function surprise(m: Meeting): number {
  return Number((m.actual - m.forecast).toFixed(1))
}

export function surpriseLabel(s: number): "偏热" | "偏冷" | "符合预期" {
  if (s > 0) return "偏热"
  if (s < 0) return "偏冷"
  return "符合预期"
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

export function fmtBps(n: number | null): string {
  if (n === null) return "—"
  if (n === 0) return "0"
  return n > 0 ? `+${n}` : String(n)
}

export function fmtFunds(n: number | null): string {
  if (n === null) return "待定"
  const lo = Math.max(0, n - 0.25)
  return `${lo.toFixed(2)}–${n.toFixed(2)}`
}

export function toUtc(s: string): number {
  const p = s.replace(/\./g, "-").split("-").map(Number)
  return Date.UTC(p[0], p[1] - 1, p[2])
}

export function interpAt(t: number, pts: { t: number; v: number }[]): number {
  if (pts.length === 0) return 0
  if (t <= pts[0].t) return pts[0].v
  const last = pts[pts.length - 1]
  if (t >= last.t) return last.v
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1]
      const b = pts[i]
      const u = (t - a.t) / (b.t - a.t)
      return a.v + u * (b.v - a.v)
    }
  }
  return last.v
}

export function decisionTag(m: Meeting): string {
  if (m.action === "Pending") return "待决议 9/16"
  if (m.action === "Hold") return "按兵不动"
  if (m.bps === null) return ACTION_LABEL[m.action]
  const signed = m.bps > 0 ? `+${m.bps}` : String(m.bps)
  return `${ACTION_LABEL[m.action]} ${signed}`
}

export function monthName(ym: string): string {
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
  const idx = Number(ym.slice(5)) - 1
  return `${months[idx] ?? ym} ${ym.slice(0, 4)}`
}

export function rangeStart(range: ChartRange): string {
  if (range === "recent") return "2025-01"
  if (range === "since22") return "2022-01"
  if (range === "since10") return "2010-01"
  return "2000-01"
}

export function fedwatchRangeStart(range: FedwatchRange): string {
  if (range === "month") return "2026-08-21"
  if (range === "meeting") return "2026-07-30"
  if (range === "qtr") return "2026-06-17"
  if (range === "ytd") return "2026-01-01"
  if (range === "since25") return "2025-01-01"
  return "2022-01-01"
}

export function fedwatchTimestamp(p: FedwatchPoint): number {
  if (p.label === "Sep 11 pre") return Date.UTC(2026, 8, 11, 12)
  if (p.label === "Sep 11 post") return Date.UTC(2026, 8, 11, 16)
  return toUtc(p.date)
}

export function monthlyFromMap(monthly: MonthlyCpi[], values: Record<string, number>): MonthlyCpi[] {
  return monthly
    .filter((d) => values[d.ym] != null)
    .map((d) => ({ ...d, actual: values[d.ym], forecast: null }))
}
