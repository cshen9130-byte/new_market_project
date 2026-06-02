import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface StrategyRow {
  strategy_one: string | null
  strategy_two: string | null
  strategy_three: string | null
}

function splitStrategyThree(s: string | null): string[] {
  if (!s) return []
  return s
    .split(/[，,]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export async function GET() {
  const rows = await query<StrategyRow>(
    `SELECT DISTINCT strategy_one, strategy_two, strategy_three
     FROM private_fund_info_bfl
     WHERE strategy_one IS NOT NULL AND strategy_one <> ''`
  )

  // Build l1 → l2 → l3[] hierarchy
  const l1Map = new Map<string, Map<string, Set<string>>>()

  for (const row of rows) {
    const l1 = row.strategy_one!
    if (!l1Map.has(l1)) l1Map.set(l1, new Map())
    const l2Map = l1Map.get(l1)!

    const l2 = row.strategy_two?.trim()
    if (!l2) continue
    if (!l2Map.has(l2)) l2Map.set(l2, new Set())
    const l3Set = l2Map.get(l2)!

    for (const v of splitStrategyThree(row.strategy_three)) {
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
