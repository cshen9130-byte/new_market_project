/**
 * account-risk/anomaly-detection
 * Same JSON shape as mom-analysis/anomaly-detection, from public.cfmmc_daily_summary.
 */
import { NextResponse } from "next/server"
import { buildAccountAnomalyPayload } from "@/lib/server/account-risk-anomaly"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const lookbackDays = Math.min(parseInt(new URL(req.url).searchParams.get("lookback") ?? "30", 10), 90)
  try {
    return NextResponse.json(await buildAccountAnomalyPayload(Number.isFinite(lookbackDays) ? lookbackDays : 30))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, latestDate: null, anomalies: [], dailySummary: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
