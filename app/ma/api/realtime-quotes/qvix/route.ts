import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { getQvixDailyBars } from "@/lib/server/qvix-realtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

export async function GET(req: Request) {
  const product = (new URL(req.url).searchParams.get("product") || "").trim().toUpperCase()
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  try {
    const bars = await getQvixDailyBars(product as IndexProduct)
    return NextResponse.json({ ok: true, product, bars })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "QVIX 日线获取失败" },
      { status: 502 },
    )
  }
}
