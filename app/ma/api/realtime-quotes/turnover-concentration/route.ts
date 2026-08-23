import { NextResponse } from "next/server"

import { getAshareTurnoverConcentration } from "@/lib/server/ashare-turnover-concentration"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const points = await getAshareTurnoverConcentration()
    return NextResponse.json({ ok: true, points })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "成交集中度计算失败" },
      { status: 502 },
    )
  }
}
