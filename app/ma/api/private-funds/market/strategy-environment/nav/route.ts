import { NextResponse } from "next/server"
import { loadStrategyAverageNav } from "@/lib/server/strategy-environment-compare"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET() {
  try {
    const data = await loadStrategyAverageNav()
    if (!data) return NextResponse.json({ error: "还没有足够的净值可以比较" }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    console.error("[strategy-environment/nav]", err)
    return NextResponse.json({ error: "策略净值对比加载失败" }, { status: 500 })
  }
}
