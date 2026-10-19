import { NextResponse } from "next/server"
import { parseFreshnessListBucket } from "@/lib/ops-data-overview"
import { listFreshnessProducts, parseDataOverviewScope } from "@/lib/server/ops-data-overview"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const bucket = parseFreshnessListBucket(searchParams.get("bucket"))
    if (!bucket) {
      return NextResponse.json({ error: "bad_filter", message: "请选择滞后2周或滞后3周" }, { status: 400 })
    }
    const scope = parseDataOverviewScope(searchParams.get("scope"))
    const body = await listFreshnessProducts(scope, bucket)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview/freshness-products]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "freshness_products_failed",
        message: timedOut ? "产品列表超时，请稍后重试" : "产品列表加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
