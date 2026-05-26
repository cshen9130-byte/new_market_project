import { NextResponse } from "next/server"

import { runGuoxinDBAnalysis } from "@/lib/server/guoxin-db-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await runGuoxinDBAnalysis()
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "国信账户数据库分析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
