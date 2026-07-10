export type TeamStrategyNode = {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

export async function loadTeamStrategyTree(): Promise<TeamStrategyNode[]> {
  try {
    const res = await fetch("/ma/api/tracking-funds/strategies?strategy_source=company&pool=all")
    const json = await res.json()
    return Array.isArray(json) ? (json as TeamStrategyNode[]) : []
  } catch {
    return []
  }
}

export function teamStrategyL1Options(tree: TeamStrategyNode[]): string[] {
  return tree.map((n) => n.l1)
}

export function teamStrategyL2Options(tree: TeamStrategyNode[], l1: string): string[] {
  if (!l1) return []
  return tree.find((n) => n.l1 === l1)?.l2s.map((n) => n.l2) ?? []
}

export function teamStrategyL3Options(tree: TeamStrategyNode[], l1: string, l2: string): string[] {
  if (!l1 || !l2) return []
  return tree.find((n) => n.l1 === l1)?.l2s.find((n) => n.l2 === l2)?.l3s ?? []
}

/** Serialize team strategy taxonomy for AI assistant system context. */
export function formatTeamStrategyTreeForPrompt(tree: TeamStrategyNode[]): string {
  if (!tree.length) return ""

  const lines: string[] = [
    "【团队策略标签体系】",
    "以下为我团队内部使用的三级策略分类（一级策略 → 二级策略 → 三级策略）。",
    "当用户询问路演材料、尽调笔记、基金产品应归入哪个团队策略时，必须优先从下列列表中选择最合适的一项。",
    "回答格式示例：",
    "一级策略：xxx",
    "二级策略：xxx",
    "三级策略：xxx",
    "（简要说明分类理由；若三级无合适选项可写「三级策略：无」或留空，但不得自创新类别名称。）",
    "",
  ]

  for (const l1 of tree) {
    lines.push(`■ ${l1.l1}`)
    for (const l2 of l1.l2s) {
      lines.push(`  ○ ${l2.l2}`)
      if (l2.l3s.length > 0) {
        lines.push(`    三级：${l2.l3s.join("、")}`)
      }
    }
  }

  return lines.join("\n")
}

function normalizeStrategyText(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)

  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      curr[j + 1] = Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

export function matchNearestTeamStrategy(value: string, options: string[]): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (options.includes(trimmed)) return trimmed

  const normalized = normalizeStrategyText(trimmed)
  for (const opt of options) {
    if (normalizeStrategyText(opt) === normalized) return opt
  }

  const lower = trimmed.toLowerCase()
  for (const opt of options) {
    if (opt.toLowerCase() === lower) return opt
  }

  const containsMatches = options.filter((opt) => {
    const optNorm = normalizeStrategyText(opt)
    return (
      opt.includes(trimmed)
      || trimmed.includes(opt)
      || optNorm.includes(normalized)
      || normalized.includes(optNorm)
    )
  })
  if (containsMatches.length === 1) return containsMatches[0]
  if (containsMatches.length > 1) {
    return containsMatches.sort(
      (a, b) => Math.abs(a.length - trimmed.length) - Math.abs(b.length - trimmed.length),
    )[0]
  }

  let best = ""
  let bestScore = Infinity
  for (const opt of options) {
    const score = levenshtein(normalizeStrategyText(opt), normalized)
    if (score < bestScore) {
      bestScore = score
      best = opt
    }
  }
  const threshold = Math.max(2, Math.floor(Math.max(normalized.length, normalizeStrategyText(best).length) * 0.45))
  return bestScore <= threshold ? best : ""
}

function matchNearestTeamStrategyCompound(value: string, options: string[]): string {
  const direct = matchNearestTeamStrategy(value, options)
  if (direct) return direct

  const parts = value
    .split(/[，,、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  for (const part of parts) {
    const matched = matchNearestTeamStrategy(part, options)
    if (matched) return matched
  }
  return ""
}

export function migrateRowTeamStrategies(
  row: { strategyLevel1: string; strategyLevel2: string; strategyLevel3: string },
  tree: TeamStrategyNode[],
): { strategyLevel1: string; strategyLevel2: string; strategyLevel3: string } {
  const l1Options = teamStrategyL1Options(tree)
  const strategyLevel1 = matchNearestTeamStrategyCompound(row.strategyLevel1, l1Options)

  const l2Options = teamStrategyL2Options(tree, strategyLevel1)
  const strategyLevel2 = strategyLevel1
    ? matchNearestTeamStrategyCompound(row.strategyLevel2, l2Options)
    : ""

  const l3Options = teamStrategyL3Options(tree, strategyLevel1, strategyLevel2)
  const strategyLevel3 = strategyLevel1 && strategyLevel2
    ? migrateStrategyLevel3(row.strategyLevel3, l3Options)
    : ""

  return { strategyLevel1, strategyLevel2, strategyLevel3 }
}

function migrateStrategyLevel3(value: string, options: string[]): string {
  const parts = value
    .split(/[，,、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return ""

  const seen = new Set<string>()
  const matched: string[] = []
  for (const part of parts) {
    const next = matchNearestTeamStrategy(part, options)
    if (next && !seen.has(next)) {
      seen.add(next)
      matched.push(next)
    }
  }
  if (matched.length > 0) return matched.join("、")

  const compound = matchNearestTeamStrategyCompound(value, options)
  return compound
}
