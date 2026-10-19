import { NextResponse } from "next/server"
import { parseFof99RecentListPolicy } from "@/lib/ops-update-channel"
import { listFof99RecentProducts } from "@/lib/server/ops-update-channel"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const policy = parseFof99RecentListPolicy(searchParams.get("policy"))
    if (!policy) {
      return NextResponse.json({ error: "bad_filter", message: "请选择跟踪方式" }, { status: 400 })
    }
    const body = await listFof99RecentProducts(policy)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview/update/recent-list-products]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "recent_list_products_failed",
        message: timedOut ? "产品列表超时，请稍后重试" : "产品列表加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
