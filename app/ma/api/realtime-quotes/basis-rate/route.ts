import { NextResponse } from "next/server"

import { getOwnIndexBasis, getRollingIndexBasis } from "@/lib/server/index-basis-rate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() || ""
  const product = url.searchParams.get("product")?.trim().toUpperCase() || symbol.slice(0, 2)
  try {
    if (symbol && !url.searchParams.get("product")) {
      const points = await getOwnIndexBasis(symbol)
      if (!points) return NextResponse.json({ ok: false, error: "不是股指期货合约" }, { status: 400 })
      return NextResponse.json({ ok: true, symbol, points })
    }
    const roles = await getRollingIndexBasis(product)
    if (!roles) return NextResponse.json({ ok: false, error: "不是股指期货品种" }, { status: 400 })
    return NextResponse.json({ ok: true, product, roles })
  } catch (err) {
    const message = err instanceof Error ? err.message : "基差率读取失败"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
