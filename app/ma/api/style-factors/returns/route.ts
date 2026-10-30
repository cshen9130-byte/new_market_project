import { NextResponse } from "next/server"
import {
  buildFuturesStyleReturns,
  resolveFuturesStyleRange,
  type FuturesStyleSector,
} from "@/lib/server/futures-style-factors"
import {
  buildFuturesStyleResponseCacheKey,
  withFuturesStyleResponseCache,
} from "@/lib/server/futures-style-response-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SECTORS = new Set<FuturesStyleSector>([
  "all",
  "commodity",
  "black",
  "nonferrous",
  "energy",
  "agri",
])

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const fromParam = sp.get("from")
  const toParam = sp.get("to")
  const sectorRaw = (sp.get("sector") || "all") as FuturesStyleSector
  const forceAuto = sp.get("auto") === "1" || sp.get("auto") === "true"
  const bypassCache = sp.get("nocache") === "1" || sp.get("nocache") === "true"

  if (!SECTORS.has(sectorRaw)) {
    return NextResponse.json({ ok: false, error: "无效的板块" }, { status: 400 })
  }

  const t0 = Date.now()
  try {
    const resolved = await resolveFuturesStyleRange(
      forceAuto ? null : fromParam,
      forceAuto ? null : toParam,
    )
    const { from, to } = resolved
    if (from > to) {
      return NextResponse.json({ ok: false, error: "起始日期不能晚于结束日期" }, { status: 400 })
    }

    const cacheKey = buildFuturesStyleResponseCacheKey({
      sector: sectorRaw,
      from,
      to,
      auto: resolved.auto || forceAuto,
      maxDate: resolved.maxDate,
    })

    const run = () =>
      buildFuturesStyleReturns(from, to, sectorRaw, {
        auto: resolved.auto || forceAuto,
        minDate: resolved.minDate,
        maxDate: resolved.maxDate,
      })

    const { body: payload, cache } = bypassCache
      ? { body: await run(), cache: "MISS" as const }
      : await withFuturesStyleResponseCache(cacheKey, run)

    const ms = Date.now() - t0
    return NextResponse.json(payload, {
      headers: {
        // Browser / CDN may keep a short fresh copy; SWR covers longer.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=600",
        "X-FS-Cache": cache,
        "X-FS-Ms": String(ms),
        "Server-Timing": `fs;dur=${ms};desc="${cache}"`,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
