import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { isTimeframeId } from "@/lib/client/timeframes"
import { getIndexSpotKline } from "@/lib/server/index-spot-kline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const product = (url.searchParams.get("product") || "").trim().toUpperCase()
  const interval = url.searchParams.get("interval") || "1m"
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  if (!isTimeframeId(interval)) {
    return NextResponse.json({ ok: false, error: "invalid interval" }, { status: 400 })
  }
  try {
    const bars = await getIndexSpotKline(product as IndexProduct, interval)
    return NextResponse.json({ ok: true, product, interval, bars })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "现货K线获取失败" },
      { status: 502 },
    )
  }
}
