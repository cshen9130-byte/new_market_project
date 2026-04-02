import { NextResponse } from "next/server"
import { browseLatestTraders } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const traders = browseLatestTraders()
    return NextResponse.json(traders)
  } catch (error) {
    const message = error instanceof Error ? error.message : "目录读取失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
