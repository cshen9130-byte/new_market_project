import { NextResponse } from "next/server"
import { filterStyleFactors, sortStyleFactors } from "@/lib/style-factors-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const keyword = searchParams.get("keyword") || ""
  const sort = searchParams.get("sort") || "name"
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)))

  const filtered = filterStyleFactors(keyword)
  const sorted = sortStyleFactors(filtered, sort, dir)
  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  const data = sorted.slice(start, start + pageSize).map((row) => ({
    code: row.code,
    name: row.name,
    unit_nav: row.unit_nav,
    nav_date: row.nav_date,
  }))

  return NextResponse.json({ data, total, page, pageSize, totalPages })
}
