import { NextResponse } from "next/server"
import { withMomCache } from "@/lib/server/mom-cache"
import { buildVarMcrSuggestions } from "@/lib/server/var-mcr-suggestions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function _GET(req: Request) {
  try {
    const payload = await buildVarMcrSuggestions(req)
    return NextResponse.json(payload)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-mcr-suggestions]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true,
        date: null,
        latestDate: null,
        selectedDate: null,
        conclusion: "暂无持仓或结算数据，无法给出处置建议。",
        breaches: [],
        objects: [],
        accountActions: [],
        approaching: { products: [], sectors: [] },
        dataGaps: { positionsWithoutAdvisor: [], equityWithoutRoster: [], rosterWithoutEquity: [], missingWarningLines: [] },
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-mcr-suggestions-mask", _GET)
