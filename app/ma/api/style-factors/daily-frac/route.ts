import { NextResponse } from "next/server"
import {
  getFuturesStyleDataBounds,
  loadFuturesStylePageFactorReturns,
} from "@/lib/server/futures-style-factors"
import {
  buildFuturesStyleResponseCacheKey,
  withFuturesStyleResponseCache,
} from "@/lib/server/futures-style-response-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") ?? ""
  const to = sp.get("to") ?? ""
  if (!ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json({ ok: false, error: "需要 from 与 to（YYYY-MM-DD）" }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ ok: false, error: "起始日期不能晚于结束日期" }, { status: 400 })
  }

  const t0 = Date.now()
  try {
    const bounds = await getFuturesStyleDataBounds()
    const cacheKey = buildFuturesStyleResponseCacheKey({
      sector: "page-factors",
      from,
      to,
      auto: false,
      maxDate: bounds.maxDate,
    })
    const { body, cache } = await withFuturesStyleResponseCache(cacheKey, () =>
      loadFuturesStylePageFactorReturns(from, to),
    )
    const ms = Date.now() - t0
    return NextResponse.json(
      { ok: true, from, to, ...body },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=600",
          "X-FS-Cache": cache,
          "X-FS-Ms": String(ms),
        },
      },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
