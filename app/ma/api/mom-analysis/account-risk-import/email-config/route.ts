import { NextRequest, NextResponse } from "next/server"
import { publicEmailConfig, saveEmailConfig } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(publicEmailConfig())
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    saveEmailConfig(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 })
  }
}
