import { query } from "@/lib/db"
import { reparentMisplacedL2s } from "@/lib/ma/team-strategy-tree"

export interface OpsStrategyL2 {
  l2: string
  l3s: string[]
}

export interface OpsStrategyL1 {
  l1: string
  l2s: OpsStrategyL2[]
}

export async function ensureTeamStrategiesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_strategies (
      id          SERIAL PRIMARY KEY,
      tree        JSONB NOT NULL DEFAULT '[]',
      updated_by  VARCHAR(255) NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function getStoredTeamStrategies(): Promise<OpsStrategyL1[]> {
  await ensureTeamStrategiesTable()
  const rows = await query<{ tree: OpsStrategyL1[] }>(
    `SELECT tree FROM ops_team_strategies ORDER BY id LIMIT 1`
  )
  if (!rows.length || !Array.isArray(rows[0].tree)) return []
  return rows[0].tree
}

export function mergeStrategyTrees(...trees: OpsStrategyL1[]): OpsStrategyL1[] {
  const l1Map = new Map<string, Map<string, Set<string>>>()

  for (const tree of trees) {
    if (!Array.isArray(tree)) continue
    for (const { l1, l2s } of tree) {
      if (!l1?.trim()) continue
      if (!l1Map.has(l1)) l1Map.set(l1, new Map())
      const l2Map = l1Map.get(l1)!
      for (const { l2, l3s } of l2s ?? []) {
        if (!l2?.trim()) continue
        if (!l2Map.has(l2)) l2Map.set(l2, new Set())
        const l3Set = l2Map.get(l2)!
        for (const l3 of l3s ?? []) {
          if (l3?.trim()) l3Set.add(l3.trim())
        }
      }
    }
  }

  const merged = Array.from(l1Map.entries())
    .sort(([a], [b]) => a.localeCompare(b, "zh"))
    .map(([l1, l2Map]) => ({
      l1,
      l2s: Array.from(l2Map.entries())
        .sort(([a], [b]) => a.localeCompare(b, "zh"))
        .map(([l2, l3Set]) => ({
          l2,
          l3s: Array.from(l3Set).sort((a, b) => a.localeCompare(b, "zh")),
        })),
    }))

  return reparentMisplacedL2s(merged)
}
