import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    pageSize,
    totalPages: 0,
  })
}
