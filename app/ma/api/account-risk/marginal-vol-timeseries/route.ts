/**
 * account-risk/marginal-vol-timeseries
 * 加权波动率% by 大类/板块/细分. Same JSON as mom-analysis/marginal-vol-timeseries.
 */
import { NextResponse } from "next/server"
import { buildMarginalVolTimeseries } from "@/lib/server/account-risk-sector-vol"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const volDays = Math.max(5, Math.min(120, parseInt(new URL(req.url).searchParams.get("volDays") ?? "20", 10)))
  try {
    return NextResponse.json(await buildMarginalVolTimeseries(volDays))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
