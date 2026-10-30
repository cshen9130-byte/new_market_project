import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV } from "@/lib/client/realtime-overlay"
import { clampIvLookbackDays } from "@/lib/client/iv-lookback"
import { getQvixDailyBars } from "@/lib/server/qvix-realtime"
import { fetchCffexAtmIvMinutes } from "@/lib/server/cffex-atm-iv-minute"
import { fetchEtfAtmIvMinutes } from "@/lib/server/atm-iv-minute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

async function fetchMultiDayMinutes(product: IndexProduct, month: string | null, days: number) {
  const meta = INDEX_IV[product]
  // Prefer CFFEX index underlyings for multi-day EM trends; ETF keys rarely have multi-day ATM.
  const keys = [...new Set([meta.fallback, meta.key])]
  for (const code of keys) {
    const live = await fetchCffexAtmIvMinutes(code, month, days)
    if (live && live.length >= 8) {
      return { bars: live, source: `em-atm:${days}d`, resolution: "minute" as const }
    }
  }
  if (days === 1 && !month) {
    for (const code of keys) {
      const live = await fetchEtfAtmIvMinutes(code)
      if (live && live.length >= 8) {
        return { bars: live, source: `sina-atm:${code}`, resolution: "minute" as const }
      }
    }
  }
  return null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const product = (url.searchParams.get("product") || "").trim().toUpperCase()
  const month = (url.searchParams.get("month") || "").trim().toUpperCase() || null
  const days = clampIvLookbackDays(url.searchParams.get("days") || 1)
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  try {
    if (month || days > 1) {
      const live = await fetchMultiDayMinutes(product as IndexProduct, month, days)
      if (live) {
        return NextResponse.json({
          ok: true,
          product,
          month,
          days,
          source: live.source,
          resolution: live.resolution,
          bars: live.bars,
        })
      }
      // Degraded: last N QVIX daily closes when multi-day minutes are unavailable (e.g. 500ETF).
      if (!month && days > 1) {
        const daily = await getQvixDailyBars(product as IndexProduct)
        const bars = daily.slice(-Math.max(days, 1))
        return NextResponse.json({
          ok: true,
          product,
          month,
          days,
          source: bars.length ? `db:${days}d` : null,
          resolution: "daily" as const,
          bars,
        })
      }
      return NextResponse.json({ ok: true, product, month, days, source: null, bars: [] })
    }
    const bars = await getQvixDailyBars(product as IndexProduct)
    return NextResponse.json({ ok: true, product, bars })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "QVIX fetch failed" },
      { status: 502 },
    )
  }
}
