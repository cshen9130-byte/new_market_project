import {
  analyzeInteriorNavGap,
  type InteriorNavHole,
} from "@/lib/server/nav-interior-gap"

/**
 * Decide whether a charted interior hole is already missing in every raw feed,
 * or only appears because merge / 复权 / correction dropped dates a feed has.
 *
 * The chart is the same series the 中间缺失超1/10 flag scores. A feed explains
 * the hole when its own dates, added back onto that chart, bring the missing
 * share back to 10% or below.
 */

export type NavGapSourceDates = {
  key: string
  label: string
  dates: string[]
}

export type NavGapCause = "source" | "rules" | "unknown"

export type NavGapDiagnosis = {
  first: string
  last: string
  ratio: number
  missing: number
  expected: number
  /** Widest holes first. */
  holes: InteriorNavHole[]
  source_count: number
  sources: string[]
  cause: NavGapCause
  cause_label: string
  cause_detail: string
}

function isoDay(raw: string): string {
  return raw.trim().slice(0, 10)
}

function quote(label: string): string {
  return `「${label}」`
}

function holeMissingCount(hole: InteriorNavHole): number {
  return Math.max(1, Math.round(hole.missing))
}

function holeWhere(hole: InteriorNavHole): string {
  return `${hole.from} 至 ${hole.to}（约缺 ${holeMissingCount(hole)} 个净值）`
}

function joinWhere(holes: InteriorNavHole[]): string {
  const top = holes.slice(0, 2).map(holeWhere)
  const extra = holes.length > 2 ? `，另有 ${holes.length - 2} 段` : ""
  return `${top.join("；")}${extra}`
}

function datesInside(dates: string[], hole: InteriorNavHole): number {
  const seen = new Set<string>()
  for (const raw of dates) {
    const date = isoDay(raw)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= hole.from || date >= hole.to) continue
    seen.add(date)
  }
  return seen.size
}

type HoleCover = {
  hole: InteriorNavHole
  covers: Array<{ label: string; count: number }>
}

function coversFor(holes: InteriorNavHole[], sources: NavGapSourceDates[]): HoleCover[] {
  return holes.map((hole) => ({
    hole,
    covers: sources
      .map((source) => ({ label: source.label, count: datesInside(source.dates, hole) }))
      .filter((cover) => cover.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh")),
  }))
}

function filledPhrase(cover: HoleCover): string {
  const names = cover.covers.slice(0, 2).map((item) => `${quote(item.label)}${item.count} 个`)
  return `${cover.hole.from} 至 ${cover.hole.to} 图表缺失，${names.join("、")}净值未采用`
}

export function diagnoseInteriorNavGap(
  chartDates: string[],
  sources: NavGapSourceDates[],
  fromDate?: string | null,
): NavGapDiagnosis {
  const stats = analyzeInteriorNavGap(chartDates, fromDate)
  const holes = [...stats.holes].sort((a, b) => b.missing - a.missing || a.from.localeCompare(b.from))
  const overlapped = sources.filter((source) => source.dates.some((raw) => {
    const date = isoDay(raw)
    return date >= stats.first && date <= stats.last
  }))
  const base = {
    first: stats.first,
    last: stats.last,
    ratio: stats.ratio,
    missing: stats.missing,
    expected: stats.expected,
    holes,
    source_count: overlapped.length,
    sources: overlapped.map((source) => source.label),
  }

  if (!stats.gapped) {
    return {
      ...base,
      cause: "unknown",
      cause_label: "未能判断",
      cause_detail: holes.length > 0 ? joinWhere(holes) : "未发现中间缺失",
    }
  }
  if (sources.length === 0) {
    return {
      ...base,
      source_count: 0,
      sources: [],
      cause: "unknown",
      cause_label: "未能判断",
      cause_detail: holes.length > 0 ? `${joinWhere(holes)}，没有读到原始净值` : "没有读到原始净值",
    }
  }

  const rawDates: string[] = []
  for (const source of sources) rawDates.push(...source.dates)
  const merged = analyzeInteriorNavGap([...chartDates, ...rawDates], fromDate)
  const covers = coversFor(holes, sources)
  const filled = covers.filter((cover) => cover.covers.length > 0)
  const empty = covers.filter((cover) => cover.covers.length === 0).map((cover) => cover.hole)

  if (!merged.gapped) {
    if (filled.length === 0) {
      return {
        ...base,
        cause: "rules",
        cause_label: "计算或修正导致",
        cause_detail: `${joinWhere(holes)}，原始净值补上后不再超过一成`,
      }
    }
    const top = filled.slice(0, 2).map(filledPhrase)
    const extra = filled.length > 2 ? `，另有 ${filled.length - 2} 段` : ""
    return {
      ...base,
      cause: "rules",
      cause_label: "计算或修正导致",
      cause_detail: `${top.join("；")}${extra}`,
    }
  }

  if (empty.length === 0) {
    const top = filled.slice(0, 2).map(filledPhrase)
    const extra = filled.length > 2 ? `，另有 ${filled.length - 2} 段` : ""
    return {
      ...base,
      cause: "source",
      cause_label: "源数据缺失",
      cause_detail: `${top.join("；")}${extra}，补上后仍超过一成`,
    }
  }

  const partial = filled[0]
  const partialNote = partial ? `；${filledPhrase(partial)}，补上后仍超过一成` : ""
  return {
    ...base,
    cause: "source",
    cause_label: "源数据缺失",
    cause_detail: `${joinWhere(empty)}，各原始源同样没有${partialNote}`,
  }
}
