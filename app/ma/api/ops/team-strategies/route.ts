import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  ensureTeamStrategiesTable,
  type OpsStrategyL1,
} from "@/lib/server/ops-team-strategies"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface StrategyStoreRow {
  tree: OpsStrategyL1[]
  updated_by: string
  updated_at: string
}

export async function GET() {
  try {
    await ensureTeamStrategiesTable()
    const rows = await query<StrategyStoreRow>(
      `SELECT tree, updated_by, updated_at
       FROM ops_team_strategies
       ORDER BY id
       LIMIT 1`
    )
    if (!rows.length) {
      return NextResponse.json({ tree: [] as OpsStrategyL1[] })
    }
    const tree = Array.isArray(rows[0].tree) ? rows[0].tree : []
    return NextResponse.json({ tree, updated_by: rows[0].updated_by, updated_at: rows[0].updated_at })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    await ensureTeamStrategiesTable()
    const body = await req.json()
    const tree = body?.tree
    const user_name = typeof body?.user_name === "string" ? body.user_name : ""

    if (!Array.isArray(tree)) {
      return NextResponse.json({ error: "tree_required" }, { status: 400 })
    }

    const existing = await query<{ id: number }>(
      `SELECT id FROM ops_team_strategies ORDER BY id LIMIT 1`
    )

    let rows: StrategyStoreRow[]
    if (existing.length) {
      rows = await query<StrategyStoreRow>(
        `UPDATE ops_team_strategies
         SET tree = $1::jsonb, updated_by = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING tree, updated_by, updated_at`,
        [JSON.stringify(tree), user_name, existing[0].id]
      )
    } else {
      rows = await query<StrategyStoreRow>(
        `INSERT INTO ops_team_strategies (tree, updated_by)
         VALUES ($1::jsonb, $2)
         RETURNING tree, updated_by, updated_at`,
        [JSON.stringify(tree), user_name]
      )
    }

    return NextResponse.json(rows[0])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
