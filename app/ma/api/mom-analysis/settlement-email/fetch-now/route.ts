import { NextResponse } from "next/server"
import { fetchSettlementFiles } from "@/lib/server/settlement-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const result = await fetchSettlementFiles()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "获取失败" }, { status: 500 })
  }
}
