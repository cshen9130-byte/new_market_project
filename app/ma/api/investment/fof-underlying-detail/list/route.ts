import { NextResponse } from "next/server"
import { listManagedFofUnderlyingDetail } from "@/lib/server/managed-fof-underlying-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const keyword = (searchParams.get("keyword") || "").trim()
    const fofFundName = (searchParams.get("fof_fund_name") || "").trim()
    const valuationDate = (searchParams.get("valuation_date") || "").trim()
    const sortParam = searchParams.get("sort") || ""
    const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc"

    const { rows, total, totalMarketValue } = await listManagedFofUnderlyingDetail({
      page,
      pageSize,
      keyword,
      fofFundName,
      valuationDate,
      sortKey: sortParam,
      sortDir,
    })

    return NextResponse.json({
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalMarketValue,
    })
  } catch (err) {
    console.error("[investment/fof-underlying-detail/list]", err)
    return NextResponse.json({ error: "Failed to load FOF underlying detail data" }, { status: 500 })
  }
}
