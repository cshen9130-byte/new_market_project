import { NextResponse } from "next/server"
import { loadManagerProducts } from "@/lib/server/manager-products-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ registration_no: string }> },
) {
  try {
    const { registration_no: rawId } = await params
    const registrationNo = decodeURIComponent(rawId).trim()
    if (!registrationNo) {
      return NextResponse.json({ error: "Missing registration_no" }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategy = (searchParams.get("strategy") || "").trim()
    const sortParam = searchParams.get("sort") || "product_name"
    const sortDir = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
    const cutoffDate = (searchParams.get("cutoff") || new Date().toISOString().slice(0, 10)).trim()

    const result = await loadManagerProducts({
      registrationNo,
      page,
      pageSize,
      keyword,
      strategy,
      sortKey: sortParam,
      sortDir,
      cutoffDate,
    })

    if (!result.manager_name) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error("[private-fund-managers/products]", err)
    return NextResponse.json({ error: "Failed to load manager products" }, { status: 500 })
  }
}
