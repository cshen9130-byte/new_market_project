import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface StrategyRow {
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
}

function parsePythonList(s: string | null): string[] {
  if (!s) return []
  try {
    return JSON.parse(s.replace(/'/g, '"')) as string[]
  } catch {
    return []
  }
}

export async function GET() {
  const rows = await query<StrategyRow>(
    `SELECT DISTINCT strategy_l1, strategy_l2, strategy_l3
     FROM private_fund_info_bfl
     WHERE strategy_l1 IS NOT NULL`
  )

  // Build l1 → l2 → l3[] hierarchy
  const l1Map = new Map<string, Map<string, Set<string>>>()

  for (const row of rows) {
    const l1 = row.strategy_l1!
    if (!l1Map.has(l1)) l1Map.set(l1, new Map())
    const l2Map = l1Map.get(l1)!

    if (!row.strategy_l2) continue
    if (!l2Map.has(row.strategy_l2)) l2Map.set(row.strategy_l2, new Set())
    const l3Set = l2Map.get(row.strategy_l2)!

    for (const v of parsePythonList(row.strategy_l3)) {
      if (v) l3Set.add(v)
    }
  }

  const result = Array.from(l1Map.entries())
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

  return NextResponse.json(result)
}
