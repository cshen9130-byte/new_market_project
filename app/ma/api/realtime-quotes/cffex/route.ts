import { NextResponse } from "next/server"

import { getCffexIndexRealtime } from "@/lib/server/cffex-index-realtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const extra = new URL(req.url).searchParams.get("symbols") || ""
    const { products, quotes } = await getCffexIndexRealtime(extra)
    return NextResponse.json({ ok: true, source: "sina", products, quotes })
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
