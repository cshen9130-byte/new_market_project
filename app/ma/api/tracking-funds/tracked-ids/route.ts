import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Returns all beian_hao values that are currently tracked, split by scope:
 *   mine  — user_custom_pool rows whose pool_key starts with "mine_"
 *   team  — all rows in the standard shared team pool tables
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
        `SELECT register_number FROM tracking_pool WHERE register_number IS NOT NULL
         UNION
         SELECT register_number FROM selected_pool WHERE register_number IS NOT NULL
         UNION
         SELECT register_number FROM core_pool WHERE register_number IS NOT NULL
         UNION
         SELECT register_number FROM hy_tracking_pool WHERE register_number IS NOT NULL
         UNION
         SELECT register_number FROM fof_mom_tracking WHERE register_number IS NOT NULL
         UNION
         SELECT register_number FROM user_custom_pool
           WHERE register_number IS NOT NULL
             AND (pool_key = 'jy_ops' OR pool_key LIKE 'custom_%')`,
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
