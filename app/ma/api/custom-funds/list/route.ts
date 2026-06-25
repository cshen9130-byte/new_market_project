import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Self-built fund list — returns empty data until storage is wired up. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))

  void searchParams.get("scope")
  void searchParams.get("strategy_source")
  void searchParams.get("strategy_l1")
  void searchParams.get("strategy_l2")
  void searchParams.get("team_member")
  void searchParams.get("keyword")
  void searchParams.get("cutoff")
  void searchParams.get("sort")
  void searchParams.get("dir")
  void searchParams.getAll("personal_tag")

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  })
}
