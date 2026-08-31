import { parseStrategyLevel3 } from "@/lib/ma/strategy-level3"

export type TeamStrategyNode = {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

const INDEX_ENHANCEMENT_L2 = "指数增强"

function zhSort(a: string, b: string): number {
  return a.localeCompare(b, "zh")
}

/** Parent L2 for a name that was stored as L2 but belongs as L3 (e.g. 500指增 → 指数增强). */
export function findParentL2ForMisplacedName(
  tree: TeamStrategyNode[],
  l1: string,
  name: string,
): string | null {
  const trimmed = name.trim()
  if (!l1 || !trimmed) return null
  const node = tree.find((n) => n.l1 === l1)
  if (!node) return null
  if (node.l2s.some((l2) => l2.l2 === trimmed)) return null
  for (const l2 of node.l2s) {
    if (l2.l3s.includes(trimmed)) return l2.l2
  }
  if (/指增$/.test(trimmed) && node.l2s.some((l2) => l2.l2 === INDEX_ENHANCEMENT_L2)) {
    return INDEX_ENHANCEMENT_L2
  }
  return null
}

/**
 * Fold L2 nodes that are actually L3 names (500指增, 风格指增, …) under their real parent.
 * Used after merging the official taxonomy with fund-assigned values.
 */
export function reparentMisplacedL2s(tree: TeamStrategyNode[]): TeamStrategyNode[] {
  return tree.map((l1Node) => {
    const l3Parent = new Map<string, string>()
    for (const l2 of l1Node.l2s) {
      for (const l3 of l2.l3s) {
        if (l3 && !l3Parent.has(l3)) l3Parent.set(l3, l2.l2)
      }
    }
    const hasIndexEnh = l1Node.l2s.some((l2) => l2.l2 === INDEX_ENHANCEMENT_L2)
    const extraL3s = new Map<string, string[]>()
    const keep: TeamStrategyNode["l2s"] = []

    for (const l2 of l1Node.l2s) {
      let parent = l3Parent.get(l2.l2)
      if (parent === l2.l2) parent = undefined
      if (!parent && hasIndexEnh && /指增$/.test(l2.l2) && l2.l2 !== INDEX_ENHANCEMENT_L2) {
        parent = INDEX_ENHANCEMENT_L2
      }
      if (parent) {
        extraL3s.set(parent, [...(extraL3s.get(parent) ?? []), l2.l2, ...l2.l3s])
      } else {
        keep.push(l2)
      }
    }

    const l2s = keep
      .map((l2) => {
        const extras = extraL3s.get(l2.l2)
        if (!extras?.length) return l2
        const seen = new Set(l2.l3s)
        const l3s = [...l2.l3s]
        for (const extra of extras) {
          const name = extra.trim()
          if (!name || seen.has(name) || name === l2.l2) continue
          seen.add(name)
          l3s.push(name)
        }
        return { l2: l2.l2, l3s: l3s.sort(zhSort) }
      })
      .sort((a, b) => zhSort(a.l2, b.l2))

    return { l1: l1Node.l1, l2s }
  })
}

/** Move a stored L2 that is really an L3 under its parent; keep original L3 tags. */
export function relevelMisplacedTeamStrategy(
  l1: string,
  l2: string,
  l3: string,
  tree: TeamStrategyNode[],
): { l1: string; l2: string; l3: string } {
  const parent = findParentL2ForMisplacedName(tree, l1, l2)
  if (!parent) return { l1, l2, l3 }
  const parts = parseStrategyLevel3(l3)
  const misplaced = l2.trim()
  if (misplaced && !parts.includes(misplaced)) parts.unshift(misplaced)
  return { l1, l2: parent, l3: parts.join(",") }
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

  const misplacedL2 = row.strategyLevel2.trim()
  const parentL2 = findParentL2ForMisplacedName(tree, strategyLevel1, misplacedL2)
  const l2Options = teamStrategyL2Options(tree, strategyLevel1)
  let strategyLevel2: string
  let l3Input = row.strategyLevel3
  if (parentL2) {
    strategyLevel2 = parentL2
    const parts = parseStrategyLevel3(row.strategyLevel3)
    if (misplacedL2 && !parts.includes(misplacedL2)) parts.unshift(misplacedL2)
    l3Input = parts.join("、")
  } else {
    strategyLevel2 = strategyLevel1
      ? matchNearestTeamStrategyCompound(row.strategyLevel2, l2Options)
      : ""
  }

  const l3Options = teamStrategyL3Options(tree, strategyLevel1, strategyLevel2)
  const strategyLevel3 = strategyLevel1 && strategyLevel2
    ? migrateStrategyLevel3(l3Input, l3Options)
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
