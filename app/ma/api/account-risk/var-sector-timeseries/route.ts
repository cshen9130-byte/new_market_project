/**
 * account-risk/var-sector-timeseries
 * 边际波动率% by 大类/板块/细分. Same JSON as mom-analysis/var-sector-timeseries.
 */
import { NextResponse } from "next/server"
import { buildVarSectorTimeseries } from "@/lib/server/account-risk-sector-vol"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const volDays = Math.max(5, Math.min(120, parseInt(sp.get("volDays") ?? "20", 10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(sp.get("corrDays") ?? "252", 10)))
  try {
    return NextResponse.json(await buildVarSectorTimeseries(volDays, corrDays))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
