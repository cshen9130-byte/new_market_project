import { NextResponse } from "next/server"

import { isTimeframeId, type TimeframeId } from "@/lib/client/timeframes"
import { getCffexKline } from "@/lib/server/cffex-kline"
import { fetchSinaFuturesQuotes } from "@/lib/server/sina-futures-hq"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SYMBOL_RE = /^(IH|IF|IC|IM)(\d{4}|0)$|^[A-Z]{1,3}\d{3,4}$/

function parseSymbols(raw: string) {
  return [...new Set(raw.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter((item) => SYMBOL_RE.test(item)))]
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()))
  return out
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase()
  const batch = parseSymbols(url.searchParams.get("symbols") || "")
  const symbols = batch.length ? batch.slice(0, 40) : symbol ? [symbol] : []
  const interval = url.searchParams.get("interval") || "1m"
  if (!symbols.length) {
    return NextResponse.json({ ok: false, error: "invalid symbol" }, { status: 400 })
  }
  if (!isTimeframeId(interval)) {
    return NextResponse.json({ ok: false, error: "invalid interval" }, { status: 400 })
  }
  const tf = interval as TimeframeId
  try {
    if (symbols.length > 1) {
      const rows = await mapPool(symbols, 6, async (item) => {
        try {
          return [item, await getCffexKline(item, tf)] as const
        } catch {
          return [item, []] as const
        }
      })
      return NextResponse.json({ ok: true, interval: tf, series: Object.fromEntries(rows) })
    }
    const one = symbols[0]
    const [candles, quotes] = await Promise.all([getCffexKline(one, tf), fetchSinaFuturesQuotes([one])])
    const quote = quotes.get(one) || null
    return NextResponse.json({ ok: true, symbol: one, interval: tf, candles, quote })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "K线获取失败" },
      { status: 502 },
    )
  }
}
