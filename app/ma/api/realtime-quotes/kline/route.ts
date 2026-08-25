import { NextResponse } from "next/server"

import { isTimeframeId } from "@/lib/client/timeframes"
import { getCffexKline } from "@/lib/server/cffex-kline"
import { fetchSinaFuturesQuotes } from "@/lib/server/sina-futures-hq"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase()
  const interval = url.searchParams.get("interval") || "1m"
  if (!/^(IH|IF|IC|IM)(\d{4}|0)$/.test(symbol) && !/^[A-Z]{1,3}\d{3,4}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "invalid symbol" }, { status: 400 })
  }
  if (!isTimeframeId(interval)) {
    return NextResponse.json({ ok: false, error: "invalid interval" }, { status: 400 })
  }
  try {
    const [candles, quotes] = await Promise.all([getCffexKline(symbol, interval), fetchSinaFuturesQuotes([symbol])])
    const quote = quotes.get(symbol) || null
    return NextResponse.json({ ok: true, symbol, interval, candles, quote })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "K线获取失败" },
      { status: 502 },
    )
  }
}
