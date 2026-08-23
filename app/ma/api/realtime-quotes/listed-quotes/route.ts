import { NextResponse } from "next/server"

import { getCffexListedQuotes } from "@/lib/server/cffex-listed-quotes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { quotes, asOf } = await getCffexListedQuotes()
    return NextResponse.json({ ok: true, quotes, asOf })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "合约行情获取失败" },
      { status: 502 },
    )
  }
}
