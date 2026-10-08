import { NextResponse } from "next/server"

import { getLiveDiscount } from "@/lib/server/basis-live-discount"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(await getLiveDiscount(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "实时升贴水获取失败" },
      { status: 502 },
    )
  }
}
