import { NextResponse } from "next/server"
import { loadStrategyEnvironment } from "@/lib/server/strategy-environment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("nocache") === "1"
  try {
    const data = await loadStrategyEnvironment(force)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[strategy-environment]", err)
    return NextResponse.json({ error: "策略环境计算失败" }, { status: 500 })
  }
}
