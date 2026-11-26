import { NextResponse } from "next/server"
import { getWeeklyReviewStrategyNav } from "@/lib/server/weekly-review-strategy-nav"
import {
  parseStrategyNavMode,
  parseStrategyNavUniverse,
  type WeeklyReviewStrategyNavVariant,
} from "@/lib/ma/weekly-review-strategy-nav"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function variantOf(raw: string | null): WeeklyReviewStrategyNavVariant {
  return raw === "futures" ? "futures" : "equity"
}

function weekOf(raw: string | null): string | undefined {
  const text = (raw ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const variant = variantOf(searchParams.get("variant"))
    const refresh = searchParams.get("refresh") === "1"
    const mode = parseStrategyNavMode(searchParams.get("mode") ?? searchParams.get("compare"))
    const universe = parseStrategyNavUniverse(searchParams.get("universe") ?? searchParams.get("source"))
    const strategy = (searchParams.get("strategy") ?? "").trim()
    const weekEnd = weekOf(searchParams.get("week_end"))
    if (mode === "compare" && !strategy) {
      return NextResponse.json({ error: "对比模式请先选择一个策略" }, { status: 400 })
    }
    const body = await getWeeklyReviewStrategyNav(variant, refresh, {
      universe,
      mode,
      strategy: mode === "compare" ? strategy : undefined,
      weekEnd,
    })
    return NextResponse.json(body)
  } catch (err) {
    console.error("[weekly-review/strategy-nav]", err)
    return NextResponse.json({ error: "策略平均净值计算失败" }, { status: 500 })
  }
}
