import { NextResponse } from "next/server"
import { listParseLogs } from "@/lib/server/ta-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(listParseLogs())
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
