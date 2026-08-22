import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Catch-all for account-risk UI fetches that still need ~22 trading days of
 * market history (or advisor/MOM-only widgets). Returns empty compatible JSON
 * so the page never falls through to /ma/api/mom-analysis/* .
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    data: [],
    rows: [],
    points: [],
    products: [],
    accounts: [],
    timeseries: [],
    latest: [],
    series: [],
    sectorSeries: [],
    sectorLS: [],
    productLS: [],
    corrMatrix: [],
    notEnoughData: true,
    notYetRun: true,
  })
}
