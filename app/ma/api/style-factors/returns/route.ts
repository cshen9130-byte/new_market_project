import { NextResponse } from "next/server"
import {
  buildFuturesStyleReturns,
  resolveFuturesStyleRange,
  type FuturesStyleSector,
} from "@/lib/server/futures-style-factors"

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

  if (!SECTORS.has(sectorRaw)) {
    return NextResponse.json({ ok: false, error: "无效的板块" }, { status: 400 })
  }

  try {
    const resolved = await resolveFuturesStyleRange(
      forceAuto ? null : fromParam,
      forceAuto ? null : toParam,
    )
    const { from, to } = resolved
    if (from > to) {
      return NextResponse.json({ ok: false, error: "起始日期不能晚于结束日期" }, { status: 400 })
    }

    const payload = await buildFuturesStyleReturns(from, to, sectorRaw, {
      auto: resolved.auto || forceAuto,
      minDate: resolved.minDate,
      maxDate: resolved.maxDate,
    })
    return NextResponse.json(payload)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
