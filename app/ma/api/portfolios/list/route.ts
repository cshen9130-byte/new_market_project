import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Portfolio list API — returns empty data until portfolio storage is wired up. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = 50

  // Accept filter params for future implementation
  void searchParams.get("scope")
  void searchParams.get("type")
  void searchParams.get("sort")
  void searchParams.get("dir")
  void searchParams.get("keyword")
  void searchParams.get("cutoff")
  void searchParams.getAll("tag")

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  })
}
