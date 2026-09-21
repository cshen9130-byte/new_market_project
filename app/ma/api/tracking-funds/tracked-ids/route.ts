import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { teamVisibleTrackingFundsUnionSql } from "@/lib/server/tracking-pool-membership"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Returns all beian_hao values that are currently tracked, split by scope:
 *   mine  — user_custom_pool rows whose pool_key starts with "mine_"
 *   team  — funds in currently visible sidebar 跟踪产品池.
 *           Hidden BFL catalog tables (private_fund_info_bfl, type6_ops_team_full)
 *           must not count: they are the fund universe, not "added to 团队跟踪".
 */
export async function GET() {
  try {
    const [mineRows, teamRows] = await Promise.all([
      query<{ register_number: string }>(
        `SELECT DISTINCT register_number
         FROM user_custom_pool
         WHERE register_number IS NOT NULL
           AND (pool_key = 'mine_default' OR pool_key LIKE 'mine_custom_%')`,
      ),
      query<{ register_number: string }>(
        `SELECT DISTINCT beian_hao AS register_number
         FROM (${teamVisibleTrackingFundsUnionSql()}) t`,
      ),
    ])

    return NextResponse.json({
      mine: mineRows.map((r) => r.register_number),
      team: teamRows.map((r) => r.register_number),
    })
  } catch (err) {
    console.error("[tracked-ids]", err)
    return NextResponse.json({ mine: [], team: [] }, { status: 500 })
  }
}
