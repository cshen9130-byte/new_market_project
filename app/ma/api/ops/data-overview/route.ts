import { NextResponse } from "next/server"
import { getDataOverview, parseDataOverviewScope } from "@/lib/server/ops-data-overview"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const scope = parseDataOverviewScope(searchParams.get("scope"))
    const refresh = searchParams.get("refresh") === "1"
    const body = await getDataOverview(scope, refresh)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "overview_failed",
        message: timedOut ? "统计超时，请稍后重试" : "数据概览加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
