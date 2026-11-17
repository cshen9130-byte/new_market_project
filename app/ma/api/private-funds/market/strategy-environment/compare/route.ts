import { NextResponse } from "next/server"
import { loadStrategyCompare } from "@/lib/server/strategy-environment-compare"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = (url.searchParams.get("key") || "").trim()
  const funds = (url.searchParams.get("funds") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)
  if (!key) return NextResponse.json({ error: "缺少策略" }, { status: 400 })
  try {
    const data = await loadStrategyCompare(key, funds)
    if (!data) return NextResponse.json({ error: "这个策略还没有足够的历史分数" }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    console.error("[strategy-environment/compare]", err)
    return NextResponse.json({ error: "对比曲线加载失败" }, { status: 500 })
  }
}
