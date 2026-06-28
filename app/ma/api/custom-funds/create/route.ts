import { NextResponse } from "next/server"
import { createCustomFund, type CustomFundScope } from "@/lib/server/custom-funds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const {
    scope,
    product_name,
    benchmark_index,
    tags,
    platform_strategy_l1,
    platform_strategy_l2,
    platform_strategy_l3,
    team_strategy_l1,
    team_strategy_l2,
    team_strategy_l3,
    created_by,
  } = body as Record<string, unknown>

  if (scope !== "team" && scope !== "mine") {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 })
  }
  if (!String(product_name || "").trim()) {
    return NextResponse.json({ error: "missing_product_name" }, { status: 400 })
  }
  if (!String(benchmark_index || "").trim()) {
    return NextResponse.json({ error: "missing_benchmark" }, { status: 400 })
  }

  const ownerUserId = currentUserId(req)
  if (scope === "mine" && !ownerUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const fund = createCustomFund({
    scope: scope as CustomFundScope,
    ownerUserId: ownerUserId || undefined,
    product_name: String(product_name),
    benchmark_index: String(benchmark_index),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    platform_strategy_l1: platform_strategy_l1 ? String(platform_strategy_l1) : undefined,
    platform_strategy_l2: platform_strategy_l2 ? String(platform_strategy_l2) : undefined,
    platform_strategy_l3: platform_strategy_l3 ? String(platform_strategy_l3) : undefined,
    team_strategy_l1: team_strategy_l1 ? String(team_strategy_l1) : undefined,
    team_strategy_l2: team_strategy_l2 ? String(team_strategy_l2) : undefined,
    team_strategy_l3: team_strategy_l3 ? String(team_strategy_l3) : undefined,
    created_by: created_by ? String(created_by) : undefined,
  })

  return NextResponse.json({ ok: true, fund })
}
