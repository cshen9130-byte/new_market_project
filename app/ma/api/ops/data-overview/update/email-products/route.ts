import { NextResponse } from "next/server"
import { parseEmailCohort, parseEmailStaleListKey } from "@/lib/ops-update-channel"
import { listEmailStaleProducts } from "@/lib/server/ops-update-channel"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const cohort = parseEmailCohort(searchParams.get("cohort"))
    const freshness = parseEmailStaleListKey(searchParams.get("freshness"))
    if (!cohort || !freshness) {
      return NextResponse.json({ error: "bad_filter", message: "请选择产品范围和滞后档" }, { status: 400 })
    }
    const body = await listEmailStaleProducts(cohort, freshness)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview/update/email-products]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "email_products_failed",
        message: timedOut ? "产品列表超时，请稍后重试" : "产品列表加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
