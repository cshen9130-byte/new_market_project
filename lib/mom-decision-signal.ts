import {
  applyPctMargin,
  buildMomSignals,
  completeSectorRows,
  signalRowKey,
  type FlowMap,
  type SignalSourceRow,
  type TsProductPoint,
  type TsSectorPoint,
} from "@/lib/ma/quant-vs-subjective-signals"
import { MOM_DECISION_ACTIONS } from "@/lib/system-notifications"

export type DecisionHit = {
  level: "sector" | "product"
  name: string
  action: string
}

/**
 * Same rows as the 日间风控 briefing tables: risk-budget signals, previous-day
 * margin applied, 其他 hidden, and neutral products omitted.
 */
export function briefingDecisionHits(input: {
  date: string
  sectors: SignalSourceRow[]
  products: SignalSourceRow[]
  quantShare: number
  quantAccounts: number
  subjectiveAccounts: number
  flows?: FlowMap
  sectorTs?: TsSectorPoint[]
  productTs?: TsProductPoint[]
}): DecisionHit[] {
  const built = buildMomSignals(
    completeSectorRows(input.sectors),
    input.products.slice(0, 40),
    "risk",
    input.quantShare,
    input.quantAccounts,
    input.subjectiveAccounts,
    input.flows,
    { includeNeutral: true, limit: 0 },
  )
  const prev = previousExposure(input.date, input.sectorTs ?? [], input.productTs ?? [])
  return built
    .map((signal) => applyPctMargin(signal, prev.get(signalRowKey(signal.level, signal.key))))
    .filter((signal) => signal.level === "sector" || signal.level === "product")
    .filter((signal) => signal.level !== "sector" || signal.key !== "其他")
    .filter((signal) => signal.level !== "product" || signal.action !== "中性")
    .map((signal) => ({ level: signal.level as "sector" | "product", name: signal.name, action: signal.action }))
}

export function momDecisionSignalMessage(input: {
  date: string
  hits: readonly DecisionHit[]
  actions: readonly string[]
}): { title: string; body: string; href: string } | null {
  const wanted = new Set(input.actions)
  const order = new Map(MOM_DECISION_ACTIONS.map((action, index) => [action, index]))
  const matched = input.hits
    .filter((hit) => wanted.has(hit.action))
    .sort((a, b) => {
      const level = (a.level === "sector" ? 0 : 1) - (b.level === "sector" ? 0 : 1)
      if (level !== 0) return level
      const action = (order.get(a.action as (typeof MOM_DECISION_ACTIONS)[number]) ?? 9)
        - (order.get(b.action as (typeof MOM_DECISION_ACTIONS)[number]) ?? 9)
      if (action !== 0) return action
      return a.name.localeCompare(b.name, "zh")
    })
  if (matched.length === 0) return null
  const onlyAdd = input.actions.length === 1 && input.actions[0] === "加码"
  return {
    title: onlyAdd ? `${input.date} 决策信号出现加码` : `${input.date} 决策信号`,
    body: matched.map((hit) => `${hit.level === "sector" ? "板块" : "品种"} ${hit.name} 的建议是${hit.action}。`).join(""),
    href: "/ma/dashboard/mom-analysis/trader-analysis?tab=quant-vs-subjective",
  }
}

function previousExposure(
  date: string,
  sectorTs: readonly TsSectorPoint[],
  productTs: readonly TsProductPoint[],
): Map<string, { q: number; s: number }> {
  let prevDate = ""
  for (const row of [...sectorTs, ...productTs]) {
    if (row.date < date && row.date > prevDate) prevDate = row.date
  }
  const prev = new Map<string, { q: number; s: number }>()
  if (!prevDate) return prev
  for (const row of sectorTs) {
    if (row.date === prevDate) prev.set(signalRowKey("sector", row.sector), { q: row.quantNetPct, s: row.subjNetPct })
  }
  for (const row of productTs) {
    if (row.date === prevDate) prev.set(signalRowKey("product", row.product), { q: row.quantNetPct, s: row.subjNetPct })
  }
  return prev
}
