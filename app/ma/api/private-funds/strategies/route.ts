import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query<{ strategy_l1: string; strategy_l2: string | null }>(
      `SELECT DISTINCT strategy_l1, strategy_l2
       FROM private_fund_info
       WHERE strategy_l1 IS NOT NULL
       ORDER BY strategy_l1, strategy_l2 NULLS LAST`
    )
    const map = new Map<string, string[]>()
    for (const r of rows) {
      const l1 = (r.strategy_l1 || "").trim()
      if (!l1 || l1 === "-") continue
      if (!map.has(l1)) map.set(l1, [])
      const l2 = (r.strategy_l2 || "").trim()
      if (l2 && l2 !== "-") map.get(l1)!.push(l2)
    }
    const data = Array.from(map.entries()).map(([l1, l2s]) => ({
      l1,
      l2s: l2s.map((l2) => ({ l2, l3s: [] as string[] })),
    }))
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
