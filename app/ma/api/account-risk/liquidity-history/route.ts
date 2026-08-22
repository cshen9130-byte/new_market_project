/**
 * account-risk/liquidity-history
 * Same JSON shape as mom-analysis/liquidity-history, from public.cfmmc_positions.
 */
import { NextResponse } from "next/server"
import { buildLiquidityHistory } from "@/lib/server/account-risk-liquidity"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const lookback = Math.min(90, Math.max(7, parseInt(new URL(req.url).searchParams.get("lookback") ?? "30", 10) || 30))
  try {
    return NextResponse.json(await buildLiquidityHistory(lookback))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) return NextResponse.json({ ok: true, data: [] })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
