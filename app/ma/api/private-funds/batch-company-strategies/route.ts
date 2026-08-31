import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { relevelMisplacedTeamStrategy } from "@/lib/ma/team-strategy-tree"
import { syncCompanyStrategyCaches } from "@/lib/server/company-strategy-sync"
import { addFundToTrackingPool } from "@/lib/server/tracking-pool-membership"
import { loadMergedTeamStrategyTree } from "@/lib/server/team-strategy-tree"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StrategyRow = {
  register_number: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
}

function trimOrEmpty(value: unknown): string {
  if (value == null) return ""
  return String(value).trim()
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { action } = body as { action?: string }

  if (action === "fetch") {
    const beian_haos = (body as { beian_haos?: unknown }).beian_haos
    if (!Array.isArray(beian_haos) || beian_haos.length === 0) {
      return NextResponse.json({ strategies: {} })
    }

    const ids = [...new Set(
      beian_haos
        .slice(0, 500)
        .map((id) => String(id).trim())
        .filter(Boolean),
    )]
    if (ids.length === 0) return NextResponse.json({ strategies: {} })

    try {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ")
      const rows = await query<StrategyRow>(
        `SELECT register_number,
                CASE
                  WHEN COALESCE(
                    NULLIF(BTRIM(company_strategy_one), ''),
                    NULLIF(BTRIM(company_strategy_two), ''),
                    NULLIF(BTRIM(company_strategy_three), '')
                  ) IS NOT NULL
                    THEN NULLIF(BTRIM(company_strategy_one), '')
                  ELSE NULLIF(BTRIM(platform_strategy_one), '')
                END AS strategy_l1,
                CASE
                  WHEN COALESCE(
                    NULLIF(BTRIM(company_strategy_one), ''),
                    NULLIF(BTRIM(company_strategy_two), ''),
                    NULLIF(BTRIM(company_strategy_three), '')
                  ) IS NOT NULL
                    THEN NULLIF(BTRIM(company_strategy_two), '')
                  ELSE NULLIF(BTRIM(platform_strategy_two), '')
                END AS strategy_l2,
                CASE
                  WHEN COALESCE(
                    NULLIF(BTRIM(company_strategy_one), ''),
                    NULLIF(BTRIM(company_strategy_two), ''),
                    NULLIF(BTRIM(company_strategy_three), '')
                  ) IS NOT NULL
                    THEN NULLIF(BTRIM(company_strategy_three), '')
                  ELSE NULLIF(BTRIM(platform_strategy_three), '')
                END AS strategy_l3
         FROM type6_ops_team_full
         WHERE register_number IN (${placeholders})`,
        ids,
      )

      const tree = await loadMergedTeamStrategyTree()
      const strategies: Record<
        string,
        { strategy_l1: string; strategy_l2: string; strategy_l3: string }
      > = {}
      for (const row of rows) {
        const releveled = relevelMisplacedTeamStrategy(
          row.strategy_l1 ?? "",
          row.strategy_l2 ?? "",
          row.strategy_l3 ?? "",
          tree,
        )
        if (!releveled.l1 && !releveled.l2 && !releveled.l3) continue
        strategies[row.register_number] = {
          strategy_l1: releveled.l1,
          strategy_l2: releveled.l2,
          strategy_l3: releveled.l3,
        }
      }

      return NextResponse.json({ strategies })
    } catch (err) {
      console.error("[batch-company-strategies] fetch error:", err)
      return NextResponse.json({ error: "database_error" }, { status: 500 })
    }
  }

  if (action === "sync") {
    const updates = (body as { updates?: unknown }).updates
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "no_updates" }, { status: 400 })
    }

    const normalized = updates
      .slice(0, 500)
      .map((item) => {
        const row = item as Record<string, unknown>
        return {
          beian_hao: trimOrEmpty(row.beian_hao),
          strategy_l1: trimOrEmpty(row.strategy_l1) || null,
          strategy_l2: trimOrEmpty(row.strategy_l2) || null,
          strategy_l3: trimOrEmpty(row.strategy_l3) || null,
        }
      })
      .filter((item) => item.beian_hao)

    if (normalized.length === 0) {
      return NextResponse.json({ error: "no_updates" }, { status: 400 })
    }

    try {
      const tree = await loadMergedTeamStrategyTree()
      const releveledUpdates = normalized.map((item) => {
        const next = relevelMisplacedTeamStrategy(
          item.strategy_l1 ?? "",
          item.strategy_l2 ?? "",
          item.strategy_l3 ?? "",
          tree,
        )
        return {
          ...item,
          strategy_l1: next.l1 || null,
          strategy_l2: next.l2 || null,
          strategy_l3: next.l3 || null,
        }
      })

      let updated = 0
      const synced: Array<typeof releveledUpdates[number] & { product_name?: string | null }> = []
      for (const item of releveledUpdates) {
        let result = await query<{ register_number: string }>(
          `UPDATE type6_ops_team_full
           SET company_strategy_one   = $2,
               company_strategy_two   = $3,
               company_strategy_three = $4,
               updated_at = NOW()
           WHERE register_number = $1
           RETURNING register_number`,
          [item.beian_hao, item.strategy_l1, item.strategy_l2, item.strategy_l3],
        )
        if (!result.length) {
          // Align with single-fund PATCH: create team-pool row when missing.
          try {
            await addFundToTrackingPool("bfl_ops", item.beian_hao, item.beian_hao)
          } catch {
            // permission / schema issues — leave as not updated
          }
          result = await query<{ register_number: string }>(
            `UPDATE type6_ops_team_full
             SET company_strategy_one   = $2,
                 company_strategy_two   = $3,
                 company_strategy_three = $4,
                 updated_at = NOW()
             WHERE register_number = $1
             RETURNING register_number`,
            [item.beian_hao, item.strategy_l1, item.strategy_l2, item.strategy_l3],
          )
        }
        if (result.length) {
          updated += result.length
          synced.push(item)
        }
      }
      await syncCompanyStrategyCaches(synced)
      return NextResponse.json({ ok: true, updated })
    } catch (err) {
      console.error("[batch-company-strategies] sync error:", err)
      return NextResponse.json({ error: "database_error" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 })
}
