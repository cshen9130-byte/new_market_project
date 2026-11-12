import { NextResponse } from "next/server"

import { isAllWeatherVariantId, parseAllWeatherVariantId } from "@/lib/all-weather/variants"
import { readPaperBook } from "@/lib/server/all-weather-book"
import { fetchAllWeatherLiveTicks } from "@/lib/server/all-weather-prices"
import { requireLoggedIn } from "@/lib/server/require-cshen"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function variantFromRequest(raw: unknown) {
  if (raw == null || raw === "") return parseAllWeatherVariantId(undefined)
  if (!isAllWeatherVariantId(raw)) return null
  return raw
}

export async function GET(req: Request) {
  const user = await requireLoggedIn(req)
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  try {
    const url = new URL(req.url)
    const variantId = variantFromRequest(url.searchParams.get("variant"))
    if (!variantId) return NextResponse.json({ error: "策略版本无效" }, { status: 400 })
    const book = readPaperBook(variantId)
    const symbols = (book?.positions ?? [])
      .map((p) => String(p.contract || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
      .filter((s) => /^[A-Z]{1,3}\d{3,4}$/.test(s))
    const { quotes, source } = await fetchAllWeatherLiveTicks(symbols)
    const liveCount = symbols.filter((s) => {
      const tick = quotes[s]
      return tick?.last != null && Number.isFinite(tick.last) && tick.last > 0
    }).length
    return NextResponse.json({ ok: true, quotes, source, liveCount })
  } catch (e) {
    const message = e instanceof Error ? e.message : "行情加载失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
