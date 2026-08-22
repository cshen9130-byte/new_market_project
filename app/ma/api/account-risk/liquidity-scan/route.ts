/**
 * account-risk/liquidity-scan
 * Same JSON shape as mom-analysis/liquidity-scan, from public.cfmmc_positions.
 */
import { NextResponse } from "next/server"
import { buildLiquidityScan } from "@/lib/server/account-risk-liquidity"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date")
  try {
    return NextResponse.json(await buildLiquidityScan(date))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, date: null, contracts: [], summary: null, notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
