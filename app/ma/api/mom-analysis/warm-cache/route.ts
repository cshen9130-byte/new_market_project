import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Warm all MOM analysis caches by calling each API route with ?nocache=1.
 * Called by nightly_etl.py after trade data is loaded.
 *
 * GET /ma/api/mom-analysis/warm-cache
 */

const ROUTES_TO_WARM = [
  // No-param routes
  "/ma/api/mom-analysis/margin-risk",
  "/ma/api/mom-analysis/account-daily-pnl",
  "/ma/api/mom-analysis/sector-ls-pnl",
  "/ma/api/mom-analysis/position-change",
  "/ma/api/mom-analysis/category-exposure",
  "/ma/api/mom-analysis/option-positions",
  "/ma/api/mom-analysis/product-nav",
  "/ma/api/mom-analysis/category-pnl",
  // Routes with default params (the page fetches these exact combos)
  "/ma/api/mom-analysis/var-sandbox",
  "/ma/api/mom-analysis/var-sandbox?volDays=20&corrDays=252",
  "/ma/api/mom-analysis/vol-corr-scatter?window=20&corrWindow=20",
]

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const results: { route: string; ok: boolean; ms: number }[] = []

  for (const route of ROUTES_TO_WARM) {
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
