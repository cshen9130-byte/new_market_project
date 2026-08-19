import { NextResponse } from "next/server"

import { getCffexIndexRealtime } from "@/lib/server/cffex-index-realtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const products = await getCffexIndexRealtime()
    return NextResponse.json({ ok: true, source: "sina", products })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "股指期货实时行情获取失败",
      },
      { status: 502 },
    )
  }
}
