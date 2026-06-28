import { NextResponse } from "next/server"
import { listCustomFunds, type CustomFundScope } from "@/lib/server/custom-funds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
  const scope = (searchParams.get("scope") === "mine" ? "mine" : "team") as CustomFundScope
  const strategySource = searchParams.get("strategy_source") === "company" ? "company" : "platform"
  const strategyL1 = searchParams.get("strategy_l1") || ""
  const strategyL2 = searchParams.get("strategy_l2") || ""
  const teamMember = searchParams.get("team_member") || ""
  const keyword = searchParams.get("keyword") || ""
  const sort = searchParams.get("sort") || "product_name"
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc"
  const personalTags = searchParams.getAll("personal_tag").filter(Boolean)

  const ownerUserId = scope === "mine" ? currentUserId(req) : undefined
  if (scope === "mine" && !ownerUserId) {
    return NextResponse.json({
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 1,
    })
  }

  void searchParams.get("cutoff")

  const result = listCustomFunds({
    page,
    pageSize,
    scope,
    ownerUserId,
    strategySource,
    strategyL1,
    strategyL2,
    teamMember,
    personalTags,
    keyword,
    sort,
    dir,
  })

  return NextResponse.json(result)
}
