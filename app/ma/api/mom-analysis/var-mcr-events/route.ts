import { NextResponse } from "next/server"
import { withMomCache } from "@/lib/server/mom-cache"
import { buildVarMcrEvents } from "@/lib/server/var-mcr-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function _GET(req: Request) {
  try {
    const payload = await buildVarMcrEvents(req)
    return NextResponse.json(payload)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-mcr-events]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true,
        date: null,
        latestDate: null,
        selectedDate: null,
        productTable: null,
        sectorTable: null,
        footnote: "暂无持仓或结算数据，无法生成拥挤事件表。",
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-mcr-events", _GET)
