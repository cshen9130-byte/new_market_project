import { NextResponse } from "next/server"
import {
  getStockMarketEtlJobStatus,
  startStockMarketEtlJob,
} from "@/lib/server/stock-market-etl-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Trigger stock-market ETL (A-share crowding, board turnover share, top stocks).
 * GET /ma/api/stock/run-etl
 * GET /ma/api/stock/run-etl?force=1  — bypass 20h dedupe guard
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1"
  const result = startStockMarketEtlJob({ force })

  if (!result.ok) {
    const status = getStockMarketEtlJobStatus()
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
    message: "Stock market ETL started",
    job: getStockMarketEtlJobStatus(),
  })
}

export async function POST(req: Request) {
  return GET(req)
}
