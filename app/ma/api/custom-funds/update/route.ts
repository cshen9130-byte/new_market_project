import { NextResponse } from "next/server"
import { updateCustomFund } from "@/lib/server/custom-funds"

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
    product_code,
    product_name,
    benchmark_index,
    tags,
    platform_strategy_l1,
    platform_strategy_l2,
    platform_strategy_l3,
    team_strategy_l1,
    team_strategy_l2,
    team_strategy_l3,
  } = body as Record<string, unknown>

  const code = String(product_code || "").trim()
  if (!code) {
    return NextResponse.json({ error: "missing_product_code" }, { status: 400 })
  }
  if (!String(product_name || "").trim()) {
    return NextResponse.json({ error: "missing_product_name" }, { status: 400 })
  }
  if (!String(benchmark_index || "").trim()) {
    return NextResponse.json({ error: "missing_benchmark" }, { status: 400 })
  }

  const ownerUserId = currentUserId(req)
  const fund = updateCustomFund({
    product_code: code,
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
  })

  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, fund })
}
