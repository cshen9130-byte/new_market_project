import { NextResponse } from "next/server"
import { addIsoDays } from "@/lib/ma/market-event-calendar-shared"
import { getLiveMarketEvents } from "@/lib/server/market-events-live"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const today = shanghaiTodayIsoDate()
  const from = String(url.searchParams.get("from") || addIsoDays(today, -90)).slice(0, 10)
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 180), 1), 180)
  const to = String(url.searchParams.get("to") || addIsoDays(from, days)).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ ok: false, error: "日期格式无效" }, { status: 400 })
  }
  const refresh = url.searchParams.get("refresh") === "1"
  const live = await getLiveMarketEvents({ from, to, refresh })
  return NextResponse.json({
    ok: true,
    today,
    from,
    to,
    source: live.source,
    fetchedAt: live.fetchedAt,
    live: live.live,
    events: live.events,
  })
}
