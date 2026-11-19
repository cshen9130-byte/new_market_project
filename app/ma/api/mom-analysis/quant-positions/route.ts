import { NextResponse } from "next/server"
import { findStaleCache, readCache, writeCache } from "@/lib/server/mom-cache-key"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** File name stem. Nightly ETL and the MOM import job write today's file. */
export const QUANT_POSITIONS_CACHE_KEY = "quant-positions-v2"
const FILE_KEY = `mom__${QUANT_POSITIONS_CACHE_KEY}`

const cacheHeaders = {
  "Cache-Control": "no-cache",
  "X-Mom-Cache": "hit",
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const nocache = url.searchParams.get("nocache") === "1"
  const raw = url.searchParams.get("date")?.trim() || null
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ ok: false, error: "date 需要 YYYY-MM-DD" }, { status: 400 })
  }
  // The button always asks for the latest day. That payload is the ETL file.
  // A dated request is a one-off and is not stored over the daily snapshot.
  const cacheable = !raw
  if (cacheable && !nocache) {
    const cached = readCache(FILE_KEY)
    if (cached) {
      return NextResponse.json(cached, { headers: cacheHeaders })
    }
    const stale = findStaleCache("mom", QUANT_POSITIONS_CACHE_KEY, "", "")
    if (stale) {
      return NextResponse.json(stale.data, { headers: { ...cacheHeaders, "X-Mom-Cache": "stale" } })
    }
  }
  try {
    const { loadQuantPositionExposure } = await import("@/lib/server/quant-position-snapshot")
    const exposure = await loadQuantPositionExposure(raw)
    const body = { ok: true, ...exposure }
    if (cacheable) writeCache(FILE_KEY, body)
    return NextResponse.json(body, { headers: { "X-Mom-Cache": "miss" } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist") || msg.includes("不存在")) {
      return NextResponse.json({
        ok: true,
        date: null,
        sectors: [],
        rows: [],
        total: { nets: {}, longs: {}, shorts: {}, net: 0, gross: 0, dailyPnl: null },
        conflicts: [],
        bullets: [],
        footnotes: ["持仓表尚未导入。"],
      })
    }
    console.error("[quant-positions]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
