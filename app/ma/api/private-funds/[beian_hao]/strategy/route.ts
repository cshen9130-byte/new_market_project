import { NextResponse } from "next/server"
import { invalidateDetailResponseMemoryCache } from "@/lib/server/fund-detail-response-memory-cache"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  isStrategyEmpty,
  loadResolvedFundStrategies,
  persistEmptyTeamStrategyFromPlatform,
} from "@/lib/server/fund-strategy-resolve"
import {
  familyHasTeamStrategy,
  loadShareClassFamilyTeamStrategies,
  writeCompanyStrategyAcrossShareClasses,
} from "@/lib/server/company-strategy-share-class"
import { relevelMisplacedTeamStrategy } from "@/lib/ma/team-strategy-tree"
import { loadMergedTeamStrategyTree } from "@/lib/server/team-strategy-tree"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function trimOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

function permissionDeniedResponse() {
  return NextResponse.json(
    { error: "数据库账号无写入权限（团队策略），请联系管理员执行 scripts/db/019_grant_type6_ops_team_full_write.sql" },
    { status: 500 },
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
    let family: Awaited<ReturnType<typeof loadShareClassFamilyTeamStrategies>>["family"] = []
    let familyMerged = resolved.company
    try {
      const loaded = await loadShareClassFamilyTeamStrategies(beian_hao)
      family = loaded.family
      familyMerged = loaded.merged
    } catch (err) {
      console.error("Share-class family strategy lookup failed:", err)
    }
    let company = resolved.company
    const familyHasTeam = familyHasTeamStrategy(family)

    // Prefer sibling A/B/C 团队策略 over copying 平台策略 onto an empty class.
    if (isStrategyEmpty(company) && !familyHasTeam && !isStrategyEmpty(resolved.platform)) {
      const wrote = await persistEmptyTeamStrategyFromPlatform(
        beian_hao,
        resolved.platform,
        resolved.product_name,
      )
      if (wrote) company = resolved.platform
    }

    const team = !isStrategyEmpty(familyMerged)
      ? familyMerged
      : (isStrategyEmpty(company) ? resolved.platform : company)
    let strategy_l1 = team.l1
    let strategy_l2 = team.l2
    let strategy_l3 = team.l3
    if (!isStrategyEmpty(team)) {
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
      share_class_family: family.map((row) => ({
        beian_hao: row.beian_hao,
        product_name: row.product_name,
      })),
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
    const result = await writeCompanyStrategyAcrossShareClasses({
      beian_hao,
      product_name,
      strategy_l1,
      strategy_l2,
      strategy_l3,
    })

    if (!result.updated.length) {
      return NextResponse.json({ error: "Fund not found in team pool" }, { status: 404 })
    }

    invalidateDetailResponseMemoryCache([
      rawId,
      beian_hao,
      ...result.updated,
      ...result.family.map((row) => row.beian_hao),
    ])

    return NextResponse.json({
      ok: true,
      updated: result.updated.length,
      strategy_l1,
      strategy_l2,
      strategy_l3,
      share_class_family: result.family,
    })
  } catch (err) {
    console.error("Strategy PATCH error:", err)
    const msg = err instanceof Error ? err.message : String(err)
    if (/permission denied|无写入权限/i.test(msg)) {
      return permissionDeniedResponse()
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
