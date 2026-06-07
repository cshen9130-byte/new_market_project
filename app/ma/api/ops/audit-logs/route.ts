import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Operation audit logs — returns empty data until storage is wired up. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)))

  void searchParams.get("type")

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  })
}
