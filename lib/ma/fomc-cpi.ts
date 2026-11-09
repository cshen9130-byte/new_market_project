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
  forecast: number | null
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
  coreForecast?: number | null
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
  now: "2026 至今",
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

export function surprise(m: Meeting): number | null {
  if (m.forecast == null || m.actual == null) return null
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
  if (m.action === "Pending") {
    const [, month, day] = m.decision.split("-")
    if (month && day) return `待决议 ${Number(month)}/${Number(day)}`
    return "待决议"
  }
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

function shiftIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  const stamp = Date.UTC(year, (month || 1) - 1, day || 1) + days * 86400000
  return new Date(stamp).toISOString().slice(0, 10)
}

export function fedwatchRangeStart(range: FedwatchRange, anchorIso: string, previousDecision?: string): string {
  const anchor = anchorIso.slice(0, 10)
  if (range === "since22") return "2022-01-01"
  if (range === "since25") return "2025-01-01"
  if (range === "ytd") return `${anchor.slice(0, 4)}-01-01`
  if (range === "meeting") return (previousDecision || shiftIso(anchor, -45)).slice(0, 10)
  if (range === "month") return shiftIso(anchor, -31)
  return shiftIso(anchor, -92)
}

export function fedwatchTimestamp(p: FedwatchPoint): number {
  if (p.label === "Sep 11 pre") return Date.UTC(2026, 8, 11, 12)
  if (p.label === "Sep 11 post") return Date.UTC(2026, 8, 11, 16)
  return toUtc(p.date)
}

function releaseAfter(ym: string): string {
  const year = Number(ym.slice(0, 4))
  const month = Number(ym.slice(5, 7))
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-06`
}

export function monthlyFromMap(monthly: MonthlyCpi[], values: Record<string, number>): MonthlyCpi[] {
  const rows = monthly
    .filter((d) => values[d.ym] != null)
    .map((d) => ({ ...d, actual: values[d.ym], forecast: null }))
  const lastYm = rows[rows.length - 1]?.ym ?? ""
  for (const ym of Object.keys(values).filter((key) => key > lastYm).sort()) {
    const released = releaseAfter(ym)
    rows.push({
      ym,
      label: released,
      released,
      actual: values[ym],
      forecast: null,
      mom: null,
      core: null,
    })
  }
  return rows
}

export type NfpPoint = { m: string; k: number; ym?: string; forecast?: number | null }

export type UsMacroBundle = {
  MEETINGS: Meeting[]
  MONTHLY: MonthlyCpi[]
  HIST_FOMC: Meeting[]
  CORE_YOY: Record<string, number>
  CORE_PCE_YOY: Record<string, number>
  SEP_HIKE_ODDS: FedwatchPoint[]
  CORE_MOM_2026: { m: string; actual: number; ym?: string }[]
  NFP_2026: NfpPoint[]
  AUG_CPI_PARTS: { name: string; v: number }[]
  CPI_PARTS_YM?: string
  UNRATE: Record<string, number>
  U6RATE: Record<string, number>
  CIVPART: Record<string, number>
  SAHM: Record<string, number>
  meta?: {
    updatedAt?: string
    fedwatch?: string
    nfpTrailAvg?: number | null
  }
}

export type MacroCard = {
  value: string
  label: string
  tone?: "hot" | "cold" | "pending" | "inline"
}

export type MacroView = {
  asOf: string
  lede: string
  watch: string
  cards: MacroCard[]
  laborCards: MacroCard[]
  year: string
  latestCpiYm: string
  headlineCore: string
  headlineCoreLabel: string
  fundsNow: string
  coreMomDesc: string
  coreMomSource: string
  partsTitle: string
  partsDesc: string
  partsSource: string
  parts: { name: string; v: number }[]
  nfpDesc: string
  nfpSource: string
  nfpTrail: number
  unrateYearDesc: string
  nfpUnrateDesc: string
  unrateDesc: string
  unrateFoot: string
  u6Desc: string
  sahmDesc: string
  partDesc: string
  cpiYoyDesc: string
  cpiYoyFoot: string
  coreCpiDesc: string
  corePceDesc: string
  cpiMomDesc: string
  cpiTableTitle: string
  cpiTableDesc: string
  fundsDesc: string
  crossDesc: string
  compareHeaders: string[]
  compareRows: string[][]
  oddsNote: string
}

const CPI_MONTH_INDEX: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

export function cpiMonthToYm(label: string): string | null {
  const [mon, year] = label.split(" ")
  const month = CPI_MONTH_INDEX[mon ?? ""]
  if (!month || !year || !/^\d{4}$/.test(year)) return null
  return `${year}-${String(month).padStart(2, "0")}`
}

function displayDay(value: string | undefined): string {
  if (!value) return "—"
  return value.replace(/\./g, "-").slice(0, 10)
}

function signedPct(n: number): string {
  const text = `${n > 0 ? "+" : ""}${n.toFixed(1)}%`
  return text
}

function lastMap(values: Record<string, number> | undefined): { ym: string; v: number } | null {
  const keys = Object.keys(values ?? {}).sort()
  if (!keys.length || !values) return null
  const ym = keys[keys.length - 1]
  return { ym, v: values[ym] }
}

function prevMap(values: Record<string, number> | undefined): { ym: string; v: number } | null {
  const keys = Object.keys(values ?? {}).sort()
  if (keys.length < 2 || !values) return null
  const ym = keys[keys.length - 2]
  return { ym, v: values[ym] }
}

export function buildMacroView(bundle: UsMacroBundle): MacroView {
  const monthly = bundle.MONTHLY.filter((row) => row.actual != null)
  const latest = monthly[monthly.length - 1] ?? null
  const meetings = [...bundle.MEETINGS].sort((a, b) => a.decision.localeCompare(b.decision))
  const pending = meetings.find((m) => m.action === "Pending") ?? null
  const decidedFunds = meetings.filter((m) => m.action !== "Pending" && m.fundsHi != null)
  const funds = decidedFunds[decidedFunds.length - 1] ?? null
  const withSurprise = meetings.filter((m) => m.action !== "Pending" && surprise(m) != null)
  const latestNfp = bundle.NFP_2026[bundle.NFP_2026.length - 1]
  const odds = bundle.SEP_HIKE_ODDS
  const latestOdds = odds[odds.length - 1] ?? null
  const prevOdds = odds.length > 1 ? odds[odds.length - 2] : null
  const coreYoy = latest ? bundle.CORE_YOY[latest.ym] : undefined
  const pce = lastMap(bundle.CORE_PCE_YOY)
  const unrate = lastMap(bundle.UNRATE)
  const u6 = lastMap(bundle.U6RATE)
  const part = lastMap(bundle.CIVPART)
  const prevPart = prevMap(bundle.CIVPART)
  const sahm = lastMap(bundle.SAHM)
  const asOf = bundle.meta?.updatedAt || displayDay(latest?.released)
  const year = (latest?.ym || asOf).slice(0, 4)
  const nfpValues = bundle.NFP_2026.map((row) => row.k).filter((value) => Number.isFinite(value))
  const nfpTrail =
    typeof bundle.meta?.nfpTrailAvg === "number"
      ? bundle.meta.nfpTrailAvg
      : nfpValues.length
        ? Math.round((nfpValues.reduce((sum, value) => sum + value, 0) / nfpValues.length) * 10) / 10
        : 0
  const nfpMonth = latestNfp?.ym ? monthName(latestNfp.ym) : (latestNfp?.m ?? "")
  const parts =
    latest && bundle.CPI_PARTS_YM === latest.ym && bundle.AUG_CPI_PARTS.length
      ? bundle.AUG_CPI_PARTS
      : [
          latest?.mom != null ? { name: "头条环比", v: latest.mom } : null,
          latest?.core != null ? { name: "核心环比", v: latest.core } : null,
          latest?.coreForecast != null ? { name: "核心环比预期", v: latest.coreForecast } : null,
        ].filter((row): row is { name: string; v: number } => row != null)

  const watch: string[] = []
  if (latest) {
    watch.push(
      `最新 CPI 是 ${monthName(latest.ym)}（${displayDay(latest.released)} 公布），同比 ${fmtPct(latest.actual)}${latest.forecast != null ? `，预期 ${fmtPct(latest.forecast)}` : ""}。`,
    )
    if (coreYoy != null) watch.push(`核心同比 ${fmtPct(coreYoy)}。`)
    if (latest.core != null) {
      watch.push(
        `核心环比 ${signedPct(latest.core)}${latest.coreForecast != null ? `，预期 ${signedPct(latest.coreForecast)}` : ""}。`,
      )
    }
  }
  if (latestNfp) {
    watch.push(
      `最新非农 ${nfpMonth} ${latestNfp.k} 千人${latestNfp.forecast != null ? `，预期 ${latestNfp.forecast} 千人` : ""}。`,
    )
  }
  if (unrate) watch.push(`失业率 ${unrate.v.toFixed(1)}%（${monthName(unrate.ym)}）。`)
  if (funds?.fundsHi != null) watch.push(`联邦基金上限 ${funds.fundsHi.toFixed(2)}%。`)
  if (pending) watch.push(`下次决议 ${pending.decision}。`)
  if (latestOdds) watch.push(`下次会议加息概率最近一点是 ${latestOdds.date} 的 ${latestOdds.hike}%。`)

  const lastThree = meetings.slice(-3)
  const compareHeaders = lastThree.map((m) => `${m.decision.slice(5)} ${ACTION_LABEL[m.action]}`)
  const fact = (pick: (m: Meeting) => string) => lastThree.map(pick)
  const compareRows = [
    ["CPI 月份", ...fact((m) => m.cpiMonth || "—")],
    [
      "头条同比",
      ...fact((m) => (m.forecast == null ? fmtPct(m.actual) : `${fmtPct(m.actual)} vs ${fmtPct(m.forecast)}`)),
    ],
    [
      "核心同比",
      ...fact((m) => {
        const ym = cpiMonthToYm(m.cpiMonth)
        return ym != null && bundle.CORE_YOY[ym] != null ? fmtPct(bundle.CORE_YOY[ym]) : "—"
      }),
    ],
    [
      "核心环比",
      ...fact((m) => {
        const ym = cpiMonthToYm(m.cpiMonth)
        const row = ym ? bundle.MONTHLY.find((item) => item.ym === ym) : undefined
        if (row?.core == null) return "—"
        return row.coreForecast == null ? signedPct(row.core) : `${signedPct(row.core)} vs ${signedPct(row.coreForecast)}`
      }),
    ],
  ]

  const coreHot = latest?.core != null && latest.coreForecast != null && latest.core > latest.coreForecast
  const nfpHot = latestNfp?.forecast != null && latestNfp.k > latestNfp.forecast

  return {
    asOf,
    lede: `按日跟踪下次 FOMC${pending ? `（${pending.decision}）` : ""}之前已经公布的通胀和就业，并对照 CME FedWatch。数据截至 ${asOf}。`,
    watch: watch.join(""),
    cards: [
      {
        value: latestOdds ? (prevOdds ? `${prevOdds.hike}% → ${latestOdds.hike}%` : `${latestOdds.hike}%`) : "—",
        label: latestOdds
          ? `${bundle.meta?.fedwatch === "cme" ? "CME FedWatch" : "加息概率"}（${latestOdds.date}）`
          : "加息概率",
        tone: latestOdds && latestOdds.hike >= 50 ? "hot" : "inline",
      },
      {
        value:
          latest?.core == null
            ? "—"
            : latest.coreForecast == null
              ? signedPct(latest.core)
              : `${signedPct(latest.core)} vs ${signedPct(latest.coreForecast)}`,
        label: latest ? `核心环比 vs 预期（${monthName(latest.ym)}）` : "核心环比",
        tone: coreHot ? "hot" : "inline",
      },
      {
        value: latestNfp
          ? latestNfp.forecast == null
            ? `${latestNfp.k}k`
            : `${latestNfp.k}k vs ${latestNfp.forecast}k`
          : "—",
        label: nfpMonth ? `${nfpMonth} 非农 vs 预期` : "最新非农",
        tone: nfpHot ? "hot" : "pending",
      },
      {
        value: unrate ? `${unrate.v.toFixed(1)}%` : "—",
        label: unrate ? `${monthName(unrate.ym)}失业率` : "失业率",
      },
    ],
    laborCards: [
      {
        value: unrate ? `${unrate.v.toFixed(1)}%` : "—",
        label: unrate ? `${monthName(unrate.ym)}失业率 U-3` : "失业率 U-3",
      },
      {
        value: u6 ? `${u6.v.toFixed(1)}%` : "—",
        label: u6 ? `${monthName(u6.ym)} U-6` : "U-6",
        tone: "pending",
      },
      {
        value: part ? `${part.v.toFixed(1)}%` : "—",
        label: part
          ? `劳动参与率${prevPart ? `（前值 ${prevPart.v.toFixed(1)}%）` : ""}`
          : "劳动参与率",
      },
      {
        value: sahm ? sahm.v.toFixed(2) : "—",
        label: sahm ? `Sahm 规则（${monthName(sahm.ym)}，阈值 0.50）` : "Sahm 规则",
        tone: sahm && sahm.v >= 0.5 ? "hot" : "cold",
      },
    ],
    year,
    latestCpiYm: latest?.ym ?? "",
    headlineCore: latest ? `${fmtPct(latest.actual)} / ${coreYoy != null ? fmtPct(coreYoy) : "—"}` : "—",
    headlineCoreLabel: latest ? `${displayDay(latest.released)} 头条 / 核心同比` : "头条 / 核心同比",
    fundsNow: funds?.fundsHi != null ? fmtFunds(funds.fundsHi) : "—",
    coreMomDesc: `季调环比。虚线 0.2% 约等于 2% 年化。${latest?.core == null ? "" : `最新${monthName(latest.ym)} ${signedPct(latest.core)}${latest.coreForecast != null ? `，预期 ${signedPct(latest.coreForecast)}` : ""}。`}`,
    coreMomSource: "来源：东方财富 美国核心 CPI 季调环比",
    partsTitle: latest ? `${monthName(latest.ym)}环比` : "最新 CPI 环比",
    partsDesc: "每次 CPI 公布后刷新。头条、核心，以及日历里的核心环比预期。",
    partsSource: "来源：东方财富环比；预期来自华尔街见闻日历",
    parts,
    nfpDesc: `千人。虚线为近 12 个月均值（${nfpTrail}k）。${latestNfp ? `最新${nfpMonth} ${latestNfp.k}k${latestNfp.forecast != null ? `，预期 ${latestNfp.forecast}k` : ""}。` : ""}`,
    nfpSource: "来源：东方财富非农就业（BLS CES）",
    nfpTrail,
    unrateYearDesc: unrate ? `季调 U-3。最新${monthName(unrate.ym)} ${unrate.v.toFixed(1)}%。` : "季调 U-3。",
    nfpUnrateDesc: `左轴新增（千人），右轴失业率。${latestNfp ? `最新非农 ${nfpMonth} ${latestNfp.k}k。` : ""}${unrate ? `失业率 ${unrate.v.toFixed(1)}%。` : ""}`,
    unrateDesc: unrate
      ? `最新${monthName(unrate.ym)} ${unrate.v.toFixed(1)}%。虚线 4.2% 约为近年 SEP 长期失业率。`
      : "虚线 4.2% 约为近年 SEP 长期失业率。",
    unrateFoot: `来源：东方财富失业率（BLS）· 2000-01 至 ${unrate?.ym ?? "—"}`,
    u6Desc: u6
      ? `U-6 含失业、边际附着者和非自愿兼职。图上最新是${monthName(u6.ym)} ${u6.v.toFixed(1)}%。`
      : "U-6 含失业、边际附着者和非自愿兼职。",
    sahmDesc: sahm
      ? `三个月均值相对过去 12 个月低点的升幅。0.50 为实时衰退信号。最新${monthName(sahm.ym)} ${sahm.v.toFixed(2)}。`
      : "0.50 为实时衰退信号。",
    partDesc: part
      ? `最新${monthName(part.ym)} ${part.v.toFixed(1)}%${prevPart ? `，前值 ${prevPart.v.toFixed(1)}%` : ""}。`
      : "劳动参与率。",
    cpiYoyDesc: latest
      ? `最新 ${displayDay(latest.released)}（${fmtPct(latest.actual)}${latest.forecast != null ? ` vs ${fmtPct(latest.forecast)}` : ""}）。${pending ? `下次决议 ${pending.decision}。` : ""}`
      : "美国 CPI 同比。",
    cpiYoyFoot: `来源：东方财富 CPI 同比（BLS）· 2000-01 至 ${latest?.ym ?? "—"} · FOMC 标记用决议日`,
    coreCpiDesc: latest
      ? `最新${monthName(latest.ym)} ${coreYoy != null ? fmtPct(coreYoy) : "—"}。只画官方实际值。`
      : "美国核心 CPI 同比。",
    corePceDesc: pce ? `最新${monthName(pce.ym)} ${pce.v.toFixed(2)}%。` : "美国核心 PCE 同比。",
    cpiMomDesc: latest
      ? `蓝 = 头条环比，红 = 核心环比。虚线 0.2% 对应 2% 年化。最新${monthName(latest.ym)}：头条 ${latest.mom == null ? "—" : signedPct(latest.mom)}，核心 ${latest.core == null ? "—" : signedPct(latest.core)}${latest.coreForecast != null ? `（预期 ${signedPct(latest.coreForecast)}）` : ""}。`
      : "美国 CPI 环比。",
    cpiTableTitle: `${year} 年 CPI 公布一览`,
    cpiTableDesc: `截至 ${displayDay(latest?.released)}。意外 = 实际 − 预期。`,
    fundsDesc: `联邦基金目标区间上限（%）。${pending ? `${decisionTag(pending)} 未计入。` : ""}`,
    crossDesc: `样本内 ${withSurprise.length} 场已完成、且有一致预期的会议。`,
    compareHeaders,
    compareRows,
    oddsNote: latestOdds
      ? bundle.meta?.fedwatch === "cme"
        ? `最近一个概率点是 ${latestOdds.date}（加息 ${latestOdds.hike}%），来自 CME 30 天联邦基金期货。`
        : bundle.meta?.fedwatch === "yield"
          ? `最近一个概率点是 ${latestOdds.date}（加息 ${latestOdds.hike}%）。CME 从这里连不上。10 月 30 日见闻报道 12 月加息概率约 70% 之后，按美国 1 年期国债收益率的变动折算（1bp 约 4 个百分点），不是 CME 官方数字。`
          : `最近一个概率点是 ${latestOdds.date}（加息 ${latestOdds.hike}%）。`
      : "每日 ETL 会尝试抓取 CME 30 天联邦基金期货。",
  }
}
