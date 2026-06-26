import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** FOF ledger records list — returns empty data until storage is wired up. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))

  void searchParams.get("run_status")
  void searchParams.get("fof_register_number")
  void searchParams.get("underlying_beian_hao")
  void searchParams.get("apply_date_from")
  void searchParams.get("apply_date_to")
  void searchParams.get("sort")
  void searchParams.get("dir")

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  })
}
