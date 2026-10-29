import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV } from "@/lib/client/realtime-overlay"
import { getQvixDailyBars } from "@/lib/server/qvix-realtime"
import { fetchCffexAtmIvMinutes } from "@/lib/server/cffex-atm-iv-minute"
import { fetchEtfAtmIvMinutes } from "@/lib/server/atm-iv-minute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const product = (url.searchParams.get("product") || "").trim().toUpperCase()
  const month = (url.searchParams.get("month") || "").trim().toUpperCase() || null
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  try {
    if (month) {
      const meta = INDEX_IV[product as IndexProduct]
      const keys = [...new Set([meta.key, meta.fallback])]
      let bars: { time: number; close: number }[] = []
      let source: string | null = null
      for (const code of keys) {
        let live = await fetchCffexAtmIvMinutes(code, month)
        if ((!live || live.length < 8) && !String(code).includes("index")) {
          live = await fetchEtfAtmIvMinutes(code)
        }
        if (live && live.length >= 8) {
          bars = live
          source = `em-atm:${month}`
          break
        }
      }
      return NextResponse.json({ ok: true, product, month, source, bars })
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
