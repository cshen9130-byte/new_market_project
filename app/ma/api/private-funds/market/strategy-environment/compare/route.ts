import { NextResponse } from "next/server"
import { isPrivateFundBenchmarkKey } from "@/lib/server/private-fund-benchmarks"
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
  const bench = (url.searchParams.get("bench") || "").trim()
  if (!key) return NextResponse.json({ error: "缺少策略" }, { status: 400 })
  if (bench && !isPrivateFundBenchmarkKey(bench)) {
    return NextResponse.json({ error: "这个基准不能用" }, { status: 400 })
  }
  try {
    const data = await loadStrategyCompare(key, funds, bench)
    if (!data) return NextResponse.json({ error: "这个策略还没有足够的历史分数" }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "这个基准没有行情" || message === "这个基准不能用") {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    console.error("[strategy-environment/compare]", err)
    return NextResponse.json({ error: "对比曲线加载失败" }, { status: 500 })
  }
}
