import { NextResponse } from "next/server"
import { listTeamData } from "@/lib/server/team-data-query-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
    const strategyL2 = (searchParams.get("strategy_l2") || "").trim()
    const strategyL3 = (searchParams.get("strategy_l3") || "").trim()
    const elementsRaw = (searchParams.get("elements") || "").trim().toLowerCase()
    const elementsFilter =
      elementsRaw === "missing" || elementsRaw === "present" ? elementsRaw : "all"
    const navLagRaw = (searchParams.get("nav_lag") || "").trim().toLowerCase()
    const navLagFilter =
      navLagRaw === "behind_2w" || navLagRaw === "within_2w" ? navLagRaw : "all"
    const sourceRaw = (searchParams.get("product_source") || "").trim().toLowerCase()
    const productSourceFilter =
      sourceRaw === "manual" || sourceRaw === "email" ? sourceRaw : "all"
    const sort = (searchParams.get("sort") || "").trim()
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"

    const { data, total } = await listTeamData({
      page,
      pageSize,
      keyword,
      strategySource,
      strategyL1,
      strategyL2,
      strategyL3,
      elementsFilter,
      navLagFilter,
      productSourceFilter,
      sort,
      sortDir,
    })

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[team-data/list]", err)
    return NextResponse.json({ error: "Failed to load team data" }, { status: 500 })
  }
}
