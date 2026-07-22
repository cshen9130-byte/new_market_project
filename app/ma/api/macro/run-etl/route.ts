import { NextResponse } from "next/server"
import {
  getMacroMarketEtlJobStatus,
  startMacroMarketEtlJob,
} from "@/lib/server/macro-market-etl-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Trigger macro-market ETL (PCA predictions, regime similarity, money-credit).
 * GET /ma/api/macro/run-etl
 * GET /ma/api/macro/run-etl?force=1  — bypass 20h dedupe guard
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1"
  const result = startMacroMarketEtlJob({ force })

  if (!result.ok) {
    const status = getMacroMarketEtlJobStatus()
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        job: status,
      },
      { status: result.reason === "already_running" ? 409 : 200 },
    )
  }

  return NextResponse.json({
    ok: true,
    message: "Macro market ETL started",
    job: getMacroMarketEtlJobStatus(),
  })
}

export async function POST(req: Request) {
  return GET(req)
}
