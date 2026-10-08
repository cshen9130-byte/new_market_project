import { NextResponse } from "next/server"
import { loadLimitUpIntraday } from "@/lib/server/limit-up-intraday"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const data = await loadLimitUpIntraday()
    return NextResponse.json(data)
  } catch (err) {
    console.error("[limit-up-intraday]", err)
    const message = err instanceof Error ? err.message : "加载涨停表现失败"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
