/** Yingmi 代销私募 catalog shapes and crawl planning. Safe to import from the client. */

export type YingmiStrategyRef = {
  level: number
  name: string
  level1Name?: string
  level2Name?: string
}

export type YingmiTreeNode = {
  name: string
  level?: number
  children?: YingmiTreeNode[]
}

export type YingmiMetric = {
  timeRange: "ytd" | "1y" | "si"
  name: "returnInterval" | "maxDrawdown"
  op: "gte" | "lte"
  value: number
}

export type YingmiSearchRequest = {
  strategy: YingmiStrategyRef
  metrics?: YingmiMetric[]
  companyName?: string
}

export type YingmiNodeProgress = {
  total: number | null
  collected: number
  truncated: boolean
  unfilteredDone: boolean
  metricsTried: string[]
  companies: string[]
  companiesTried: string[]
}

export type YingmiProduct = {
  fundCode: string
  fundName: string
  companyName: string
  strategyLevel1: string
  strategyLevel2: string | null
  strategyLevel3: string | null
  setupDate: string | null
  navDate: string | null
  navUnit: number | null
  return1y: number | null
  maxDrawdown1y: number | null
  performanceHideReason: string | null
  note: string
}

export const YINGMI_RETURN_SLICES: YingmiMetric[][] = [
  [{ timeRange: "si", name: "returnInterval", op: "gte", value: 0.5 }],
  [{ timeRange: "si", name: "returnInterval", op: "gte", value: 0.05 }],
  [{ timeRange: "si", name: "returnInterval", op: "gte", value: -0.1 }],
  [{ timeRange: "1y", name: "returnInterval", op: "gte", value: -0.1 }],
  [{ timeRange: "1y", name: "returnInterval", op: "gte", value: -0.9 }],
  [{ timeRange: "1y", name: "maxDrawdown", op: "lte", value: 0.2 }],
  [{ timeRange: "1y", name: "maxDrawdown", op: "lte", value: 0.5 }],
]

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function shanghaiParts(now = new Date()): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ""
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    weekday: WEEKDAY[pick("weekday")] ?? 0,
  }
}

export function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function weekStartSunday(date: string, weekday: number): string {
  return addCalendarDays(date, -weekday)
}

export type YingmiRunDecision = "skip" | "continue" | "fresh"

export function decideYingmiRun(input: {
  today: string
  weekday: number
  status: string
  runStartedOn: string | null
  finishedOn: string | null
  callsDay: string | null
  force: boolean
}): { action: YingmiRunDecision; reason: string } {
  const weekStart = weekStartSunday(input.today, input.weekday)
  const startedThisWeek = Boolean(input.runStartedOn && input.runStartedOn >= weekStart)
  const finishedThisWeek = Boolean(input.finishedOn && input.finishedOn >= weekStart)
  if (!input.force && input.weekday !== 0 && input.weekday !== 1) {
    return { action: "skip", reason: "自动拉取只在周日和周一" }
  }
  if (input.status === "paused_quota" && input.callsDay === input.today && !input.force) {
    return { action: "skip", reason: "今天的额度已经停过，等次日 0 点后继续" }
  }
  if (input.status === "complete" && finishedThisWeek && !input.force) {
    return { action: "skip", reason: "本周已经拉完" }
  }
  if (startedThisWeek && input.status !== "complete" && input.status !== "idle") {
    return { action: "continue", reason: "接着本周没拉完的进度" }
  }
  return { action: "fresh", reason: "从策略树重新开始，已有产品先保留" }
}

export function isYingmiQuotaMessage(text: string): boolean {
  return text.includes("请求次数已达上限") || text.includes("SUITABILITY_REQUIRED")
}

export function strategyKey(strategy: YingmiStrategyRef): string {
  if (strategy.level <= 1) return strategy.name
  if (strategy.level === 2) return `${strategy.level1Name || ""}/${strategy.name}`
  return `${strategy.level1Name || ""}/${strategy.level2Name || ""}/${strategy.name}`
}

export function metricKey(metrics?: YingmiMetric[]): string {
  return JSON.stringify(metrics ?? [])
}

export function strategiesFromTree(tree: YingmiTreeNode[]): YingmiStrategyRef[] {
  const out: YingmiStrategyRef[] = []
  function walk(nodes: YingmiTreeNode[], parents: string[], depth: number) {
    for (const node of nodes) {
      const level = node.level || depth
      const ref: YingmiStrategyRef = { level, name: node.name }
      if (level >= 2) ref.level1Name = parents[0]
      if (level >= 3) ref.level2Name = parents[1]
      out.push(ref)
      if (node.children?.length) walk(node.children, [...parents, node.name], level + 1)
    }
  }
  walk(tree, [], 1)
  return out
}

export function level1Strategies(tree: YingmiTreeNode[]): YingmiStrategyRef[] {
  return strategiesFromTree(tree).filter((item) => item.level === 1)
}

export function childStrategies(tree: YingmiTreeNode[], parent: YingmiStrategyRef): YingmiStrategyRef[] {
  return strategiesFromTree(tree).filter((item) => {
    if (parent.level === 1) return item.level === 2 && item.level1Name === parent.name
    if (parent.level === 2) return item.level === 3 && item.level1Name === parent.level1Name && item.level2Name === parent.name
    return false
  })
}

export function emptyProgress(): YingmiNodeProgress {
  return {
    total: null,
    collected: 0,
    truncated: false,
    unfilteredDone: false,
    metricsTried: [],
    companies: [],
    companiesTried: [],
  }
}

export function nextYingmiSearch(
  strategies: YingmiStrategyRef[],
  progress: Record<string, YingmiNodeProgress>,
): YingmiSearchRequest | null {
  for (const strategy of strategies) {
    const node = progress[strategyKey(strategy)]
    if (!node?.unfilteredDone) return { strategy }
  }
  for (const strategy of strategies) {
    const node = progress[strategyKey(strategy)]
    if (!node?.truncated) continue
    if (node.total != null && node.collected >= node.total) continue
    for (const slice of YINGMI_RETURN_SLICES) {
      if (!node.metricsTried.includes(metricKey(slice))) return { strategy, metrics: slice }
    }
  }
  for (const strategy of strategies) {
    const node = progress[strategyKey(strategy)]
    if (!node?.truncated) continue
    if (node.total != null && node.collected >= node.total) continue
    for (const companyName of node.companies) {
      if (!node.companiesTried.includes(companyName)) return { strategy, companyName }
    }
  }
  return null
}

export function shortStrategy(name: string, peers: string[]): string {
  if (!name.endsWith("策略")) return name
  const cut = name.slice(0, -2)
  if (cut.length < 2) return name
  if (peers.includes(cut)) return name
  return cut
}

export function shortManager(name: string): string {
  const mark = "私募"
  const at = name.indexOf(mark)
  if (at >= 0) {
    const cut = name.slice(0, at + mark.length)
    if (name.length > cut.length) return cut
  }
  return name
    .replace(/（有限合伙）|\(有限合伙\)/g, "")
    .replace(/(管理)?(股份)?有限公司$/, "")
    .replace(/合伙企业$/, "")
}

export function yingmiNote(reason: string | null | undefined): string {
  if (!reason) return ""
  const young = reason.includes("未满半年")
  const small = reason.includes("规模不足")
  if (young && small) return "成立未满半年，规模不足1000万"
  if (young) return "成立未满半年"
  if (small) return "规模不足1000万"
  return reason
}

export function formatNav(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(4)
}

export function formatReturn(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const text = `${(value * 100).toFixed(2)}%`
  return value > 0 ? `+${text}` : text
}

export function formatDrawdown(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(2)}%`
}

export type YingmiSortKey = "strategy" | "name" | "manager" | "setup" | "navDate" | "nav" | "return1y" | "drawdown" | "note"

const TEXT_SORT = new Set<YingmiSortKey>(["strategy", "name", "manager", "note"])

export function defaultYingmiSortDir(key: YingmiSortKey): "asc" | "desc" {
  return TEXT_SORT.has(key) ? "asc" : "desc"
}

export function compareYingmiRows(
  a: YingmiProduct,
  b: YingmiProduct,
  key: YingmiSortKey,
  dir: "asc" | "desc",
  label: (row: YingmiProduct) => string,
): number {
  const sign = dir === "asc" ? 1 : -1
  const av = yingmiSortValue(a, key, label)
  const bv = yingmiSortValue(b, key, label)
  const aEmpty = av == null || av === ""
  const bEmpty = bv == null || bv === ""
  if (aEmpty && bEmpty) return a.fundName.localeCompare(b.fundName, "zh")
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign || a.fundName.localeCompare(b.fundName, "zh")
  return String(av).localeCompare(String(bv), "zh") * sign || a.fundName.localeCompare(b.fundName, "zh")
}

function yingmiSortValue(row: YingmiProduct, key: YingmiSortKey, label: (row: YingmiProduct) => string): string | number | null {
  if (key === "strategy") return label(row)
  if (key === "name") return row.fundName
  if (key === "manager") return shortManager(row.companyName)
  if (key === "setup") return row.setupDate
  if (key === "navDate") return row.navDate
  if (key === "nav") return row.navUnit
  if (key === "return1y") return row.return1y
  if (key === "drawdown") return row.maxDrawdown1y
  return row.note
}
