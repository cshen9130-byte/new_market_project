import type { NavAnomalyHit, NavAnomalyPoint } from "@/lib/server/nav-anomaly"

/**
 * Decide whether a charted NAV jump/spike is already in one upstream feed,
 * or only appears after we merge feeds and recompute 复权 / 累计.
 *
 * A feed explains the anomaly when one raw column contains every step point.
 * The column can match the charted levels, or the same return when 复权 is a
 * constant scale of that column. A mix of 复权 and 单位 does not count.
 */

export const NAV_SOURCE_LABELS: Record<string, string> = {
  email_virtual: "虚拟净值",
  email_nav_table: "邮件净值表",
  email_valuation: "邮件估值表",
  email_other: "邮件净值",
  manual: "手动净值",
  fof99: "火富牛",
  type6: "Type6",
  group: "分组净值",
  hy: "HY净值",
}

export const NAV_SOURCE_RANK = [
  "email_virtual",
  "email_nav_table",
  "email_valuation",
  "email_other",
  "manual",
  "fof99",
  "type6",
  "group",
  "hy",
] as const

export function navSourceLabel(key: string): string {
  return NAV_SOURCE_LABELS[key] ?? key
}

export type NavSourceField = "adjusted" | "cumulative" | "unit"

export type NavSourcePoint = NavAnomalyPoint & {
  /** Which raw column this number came from. Both sides of a step must share one field. */
  field: NavSourceField
}

export type NavSourceSeries = {
  key: string
  label: string
  /** Same date may appear more than once when a feed stored several rows or columns. */
  points: NavSourcePoint[]
}

const LEVEL_ABS_TOLERANCE = 0.001
const LEVEL_REL_TOLERANCE = 0.02

function levelsClose(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false
  return Math.abs(a - b) <= LEVEL_ABS_TOLERANCE || Math.abs(a - b) / Math.max(a, b) <= LEVEL_REL_TOLERANCE
}

function anyClose(source: NavSourceSeries, date: string, target: number): boolean {
  for (const point of source.points) {
    if (point.date === date && levelsClose(point.value, target)) return true
  }
  return false
}

const NAV_SOURCE_FIELDS: NavSourceField[] = ["adjusted", "cumulative", "unit"]

function ratiosClose(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false
  return Math.abs(a - b) / Math.max(a, b) <= LEVEL_REL_TOLERANCE
}

function valuesOn(source: NavSourceSeries, date: string, field: NavSourceField): number[] {
  const values: number[] = []
  for (const row of source.points) {
    if (row.date === date && row.field === field) values.push(row.value)
  }
  return values
}

/** One raw column holds the charted levels, or the same return under a fixed 复权 scale. */
function fieldExplains(source: NavSourceSeries, step: NavAnomalyPoint[], field: NavSourceField): boolean {
  const columns = step.map((point) => valuesOn(source, point.date, field))
  if (columns.some((values) => values.length === 0)) return false
  if (columns.every((values, index) => values.some((value) => levelsClose(value, step[index].value)))) return true
  for (let i = 1; i < step.length; i += 1) {
    const chartRatio = step[i].value / step[i - 1].value
    const matched = columns[i - 1].some((left) => columns[i].some((right) => ratiosClose(right / left, chartRatio)))
    if (!matched) return false
  }
  return step.length > 1
}

/** Feeds where one raw column, not a mix of 复权 and 单位, contains every step point. */
function feedsExplaining(sources: NavSourceSeries[], step: Array<NavAnomalyPoint | null>): string[] {
  if (step.some((point) => point == null)) return []
  const points = step as NavAnomalyPoint[]
  const keys: string[] = []
  for (const source of sources) {
    if (NAV_SOURCE_FIELDS.some((field) => fieldExplains(source, points, field))) keys.push(source.key)
  }
  return keys
}

function quote(labels: string[]): string {
  return labels.map((label) => `「${label}」`).join("")
}

function orderedLabels(keys: Iterable<string>, sources: NavSourceSeries[]): string[] {
  const wanted = new Set(keys)
  const rank = new Map<string, number>(NAV_SOURCE_RANK.map((key, index) => [key, index]))
  return sources
    .filter((source) => wanted.has(source.key))
    .sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99) || a.label.localeCompare(b.label, "zh"))
    .map((source) => source.label)
}

function chartPoint(chart: NavAnomalyPoint[], snippet: NavAnomalyPoint[], date: string): NavAnomalyPoint | null {
  const fromSnippet = snippet.find((point) => point.date === date)
  if (fromSnippet) return fromSnippet
  for (let i = chart.length - 1; i >= 0; i -= 1) {
    if (chart[i]?.date === date) return chart[i]
  }
  return null
}

function sourcesMatching(sources: NavSourceSeries[], point: NavAnomalyPoint | null): string[] {
  if (!point) return []
  const keys: string[] = []
  for (const source of sources) {
    if (anyClose(source, point.date, point.value)) keys.push(source.key)
  }
  return keys
}

export function diagnoseNavAnomaly(
  chart: NavAnomalyPoint[],
  sources: NavSourceSeries[],
  hit: NavAnomalyHit,
): Pick<NavAnomalyHit, "source_count" | "sources" | "cause" | "cause_label" | "cause_detail"> {
  const snippetIndex = hit.snippet.findIndex((point) => point.date === hit.date)
  const prevDate = snippetIndex > 0 ? hit.snippet[snippetIndex - 1]?.date : undefined
  const nextDate = snippetIndex >= 0 ? hit.snippet[snippetIndex + 1]?.date : undefined
  const flagged = chartPoint(chart, hit.snippet, hit.date)
  const prev = prevDate ? chartPoint(chart, hit.snippet, prevDate) : null
  const next = nextDate ? chartPoint(chart, hit.snippet, nextDate) : null

  const matched = new Set<string>()
  const overlapped = new Set<string>()
  for (const point of chart.length > 0 ? chart : hit.snippet) {
    for (const source of sources) {
      if (!source.points.some((row) => row.date === point.date)) continue
      overlapped.add(source.key)
      if (anyClose(source, point.date, point.value)) matched.add(source.key)
    }
  }
  const shownKeys = matched.size > 0 ? matched : overlapped
  const shown = orderedLabels(shownKeys, sources)
  const sourceCount = shown.length

  if (sources.length === 0) {
    return {
      source_count: 0,
      sources: [],
      cause: "unknown",
      cause_label: "未能判断",
      cause_detail: "没有读到原始净值",
    }
  }

  const stepName = hit.reason === "spike" ? "尖刺" : "跳变"
  const flagKeys = sourcesMatching(sources, flagged)
  const prevKeys = sourcesMatching(sources, prev)
  const explaining = hit.reason === "spike"
    ? feedsExplaining(sources, [prev, flagged, next])
    : feedsExplaining(sources, [prev, flagged])

  if (explaining.length > 0) {
    const labels = orderedLabels(explaining, sources)
    const detail = labels.length === 1
      ? `${stepName}在${quote(labels)}原始数据中`
      : `${stepName}同时在${quote(labels)}原始数据中`
    return {
      source_count: sourceCount,
      sources: shown,
      cause: "source",
      cause_label: "源数据异常",
      cause_detail: detail,
    }
  }

  const prevLabels = orderedLabels(prevKeys, sources)
  const flagLabels = orderedLabels(flagKeys, sources)
  let detail = `${stepName}点与原始净值不一致`
  if (prevLabels.length > 0 && flagLabels.length > 0) {
    detail = `${quote(prevLabels)}接到${quote(flagLabels)}`
  } else if (prevLabels.length > 0 && flagLabels.length === 0) {
    detail = `前一点在${quote(prevLabels)}，${stepName}点由计算或修正生成`
  } else if (flagLabels.length > 0 && prevLabels.length === 0) {
    detail = `${stepName}点在${quote(flagLabels)}，前一点由计算或修正生成`
  } else if (matched.size === 0 && overlapped.size > 0) {
    detail = "同一天的原始净值已被计算或修正改写"
  } else if (overlapped.size === 0) {
    detail = "净值不在库内原始源中，疑似计算或修正结果"
  }

  return {
    source_count: sourceCount,
    sources: shown,
    cause: "rules",
    cause_label: "计算或修正导致",
    cause_detail: detail,
  }
}
