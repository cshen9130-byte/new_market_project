import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { syncCompanyStrategyCaches } from "@/lib/server/company-strategy-sync"
import { invalidateDetailResponseMemoryCache } from "@/lib/server/fund-detail-response-memory-cache"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  isStrategyEmpty,
  loadResolvedFundStrategies,
  persistEmptyTeamStrategyFromPlatform,
} from "@/lib/server/fund-strategy-resolve"
import { addFundToTrackingPool } from "@/lib/server/tracking-pool-membership"
import { relevelMisplacedTeamStrategy } from "@/lib/ma/team-strategy-tree"
import { loadMergedTeamStrategyTree } from "@/lib/server/team-strategy-tree"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function trimOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

async function updateCompanyStrategy(
  beian_hao: string,
  strategy_l1: string | null,
  strategy_l2: string | null,
  strategy_l3: string | null,
) {
  return query<{ register_number: string }>(
    `UPDATE type6_ops_team_full
     SET company_strategy_one   = $2,
         company_strategy_two   = $3,
         company_strategy_three = $4,
         updated_at = NOW()
     WHERE register_number = $1
     RETURNING register_number`,
    [beian_hao, strategy_l1, strategy_l2, strategy_l3],
  )
}

/** Return 团队策略 for edit dialogs; fall back to 平台策略 (and persist) when team is empty. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao: rawId } = await params
  const beian_hao = await resolveRouteFundId(rawId)
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  try {
    const resolved = await loadResolvedFundStrategies(beian_hao, [rawId])
    let company = resolved.company
    if (isStrategyEmpty(company) && !isStrategyEmpty(resolved.platform)) {
      const wrote = await persistEmptyTeamStrategyFromPlatform(
        beian_hao,
        resolved.platform,
        resolved.product_name,
      )
      if (wrote) company = resolved.platform
    }
    const team = isStrategyEmpty(company) ? resolved.platform : company
    let strategy_l1 = team.l1
    let strategy_l2 = team.l2
    let strategy_l3 = team.l3
    if (!isStrategyEmpty(company)) {
      const tree = await loadMergedTeamStrategyTree()
      const releveled = relevelMisplacedTeamStrategy(
        strategy_l1 ?? "",
        strategy_l2 ?? "",
        strategy_l3 ?? "",
        tree,
      )
      strategy_l1 = releveled.l1 || null
      strategy_l2 = releveled.l2 || null
      strategy_l3 = releveled.l3 || null
    }
    return NextResponse.json({
      beian_hao,
      strategy_l1,
      strategy_l2,
      strategy_l3,
      company_l1: company.l1,
      company_l2: company.l2,
      company_l3: company.l3,
      platform_l1: resolved.platform.l1,
      platform_l2: resolved.platform.l2,
      platform_l3: resolved.platform.l3,
    })
  } catch (err) {
    console.error("Strategy GET error:", err)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao: rawId } = await params
  const beian_hao = await resolveRouteFundId(rawId)
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const product_name = trimOrNull(body.product_name) || beian_hao
  const tree = await loadMergedTeamStrategyTree()
  const releveled = relevelMisplacedTeamStrategy(
    trimOrNull(body.strategy_l1) ?? "",
    trimOrNull(body.strategy_l2) ?? "",
    trimOrNull(body.strategy_l3) ?? "",
    tree,
  )
  const strategy_l1 = releveled.l1 || null
  const strategy_l2 = releveled.l2 || null
  const strategy_l3 = releveled.l3 || null

  try {
    let result = await updateCompanyStrategy(beian_hao, strategy_l1, strategy_l2, strategy_l3)

    // Product may exist in BFL / list cache but not yet in the team ops table.
    if (!result.length) {
      try {
        await addFundToTrackingPool("bfl_ops", beian_hao, product_name)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/permission denied|无写入权限/i.test(msg)) {
          return NextResponse.json(
            { error: "数据库账号无写入权限（团队策略），请联系管理员执行 scripts/db/019_grant_type6_ops_team_full_write.sql" },
            { status: 500 },
          )
        }
        throw err
      }
      result = await updateCompanyStrategy(beian_hao, strategy_l1, strategy_l2, strategy_l3)
    }

    if (!result.length) {
      return NextResponse.json({ error: "Fund not found in team pool" }, { status: 404 })
    }

    await syncCompanyStrategyCaches([
      { beian_hao, strategy_l1, strategy_l2, strategy_l3, product_name },
    ])
    // Also bust detail cache keyed by the raw URL id (may differ from resolved beian).
    invalidateDetailResponseMemoryCache([rawId, beian_hao])

    return NextResponse.json({
      ok: true,
      updated: result.length,
      strategy_l1,
      strategy_l2,
      strategy_l3,
    })
  } catch (err) {
    console.error("Strategy PATCH error:", err)
    const msg = err instanceof Error ? err.message : String(err)
    if (/permission denied/i.test(msg)) {
      return NextResponse.json(
        { error: "数据库账号无写入权限（团队策略），请联系管理员执行 scripts/db/019_grant_type6_ops_team_full_write.sql" },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
