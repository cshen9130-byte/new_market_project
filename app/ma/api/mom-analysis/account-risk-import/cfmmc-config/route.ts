import { NextRequest, NextResponse } from "next/server"
import { publicCfmmcConfig, saveCfmmcSettings } from "@/lib/server/account-risk-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(publicCfmmcConfig())
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    saveCfmmcSettings(body)
    return NextResponse.json({ ok: true, config: publicCfmmcConfig() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 })
  }
}
