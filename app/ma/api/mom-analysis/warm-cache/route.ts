import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Warm all MOM analysis caches by calling each API route with ?nocache=1.
 * Called by nightly_etl.py after trade data is loaded.
 *
 * GET /ma/api/mom-analysis/warm-cache
 */

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

function isoMonthOffset(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function buildRoutesToWarm() {
  const today = isoToday()
  const sixMonthsAgo = isoMonthOffset(-6)

  return [
    "/ma/api/mom-analysis/product-nav",
    "/ma/api/mom-analysis/category-pnl",
    "/ma/api/mom-analysis/account-daily-pnl",
    "/ma/api/mom-analysis/sector-ls-pnl",
    `/ma/api/mom-analysis/benchmark?from=2020-01-01&to=${today}&codes=NHCI.NH`,
    "/ma/api/mom-analysis/margin-risk",
    "/ma/api/mom-analysis/vol-corr-scatter?window=20&corrWindow=20",
    "/ma/api/mom-analysis/var-prediction?confidence=95&volDays=20&corrDays=252&distModel=normal",
    "/ma/api/mom-analysis/var-optimize",
    "/ma/api/mom-analysis/position-change",
    "/ma/api/mom-analysis/position-change-detail",
    "/ma/api/mom-analysis/option-positions",
    "/ma/api/mom-analysis/today-position-detail",
    "/ma/api/mom-analysis/today-position-detail?rank=2",
    "/ma/api/mom-analysis/var-sandbox",
    "/ma/api/mom-analysis/var-sandbox?volDays=20&corrDays=252",
    "/ma/api/mom-analysis/var-sector-timeseries?corrDays=252",
    "/ma/api/mom-analysis/pnl-sector-timeseries",
    "/ma/api/mom-analysis/marginal-vol-timeseries",
    // advisor-vol: all window × compare combos the page can request
    "/ma/api/mom-analysis/advisor-vol?window=5",
    "/ma/api/mom-analysis/advisor-vol?window=10",
    "/ma/api/mom-analysis/advisor-vol?window=20",
    "/ma/api/mom-analysis/advisor-vol?window=5&compare=1",
    "/ma/api/mom-analysis/advisor-vol?window=5&compare=5",
    "/ma/api/mom-analysis/advisor-vol?window=5&compare=20",
    "/ma/api/mom-analysis/advisor-vol?window=5&compare=252",
    "/ma/api/mom-analysis/advisor-vol?window=10&compare=1",
    "/ma/api/mom-analysis/advisor-vol?window=10&compare=5",
    "/ma/api/mom-analysis/advisor-vol?window=10&compare=20",
    "/ma/api/mom-analysis/advisor-vol?window=10&compare=252",
    "/ma/api/mom-analysis/advisor-vol?window=20&compare=1",
    "/ma/api/mom-analysis/advisor-vol?window=20&compare=5",
    "/ma/api/mom-analysis/advisor-vol?window=20&compare=20",
    "/ma/api/mom-analysis/advisor-vol?window=20&compare=252",
    `/ma/api/mom-analysis/advisor-equity-curve?product=%E5%85%A8%E9%83%A8&from=${sixMonthsAgo}&to=${today}&advisorSector=%E5%85%A8%E9%83%A8&background=%E5%85%A8%E9%83%A8&style=%E5%85%A8%E9%83%A8&cycle=%E5%85%A8%E9%83%A8&isArbitrage=%E5%85%A8%E9%83%A8&mainStrength=%E5%85%A8%E9%83%A8&region=%E5%85%A8%E9%83%A8`,
    "/ma/api/mom-analysis/advisor-corr-ts?window=20",
    "/ma/api/mom-analysis/risk-return?window=60",
    "/ma/api/mom-analysis/risk-return?window=60&cap=0.15",
    "/ma/api/mom-analysis/capital-efficiency?window=60",
    "/ma/api/mom-analysis/reallocation?window=60&cap=0.15",
    "/ma/api/mom-analysis/risk-contribution?window=60",
    "/ma/api/mom-analysis/sector-leverage-heatmap?window=120",
    "/ma/api/mom-analysis/category-exposure",
    "/ma/api/mom-analysis/au-trading/meta",
  ]
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const routesToWarm = buildRoutesToWarm()
  const results: { route: string; ok: boolean; ms: number }[] = []

  for (const route of routesToWarm) {
    const sep = route.includes("?") ? "&" : "?"
    const url = `${origin}${route}${sep}nocache=1`
    const t0 = Date.now()
    try {
      const resp = await fetch(url)
      results.push({ route, ok: resp.ok, ms: Date.now() - t0 })
    } catch (e) {
      results.push({ route, ok: false, ms: Date.now() - t0 })
    }
  }

  const totalMs = results.reduce((s, r) => s + r.ms, 0)
  return NextResponse.json({ ok: true, totalMs, results })
}
