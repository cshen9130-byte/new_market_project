import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const latest = await publicQuery(`SELECT MAX(trade_date)::text AS date FROM public.cfmmc_option_trades`)
    const latestDate = (latest.rows[0] as { date: string | null } | undefined)?.date
    if (!latestDate) return NextResponse.json({ ok: true, rows: [], date: null })
    const n = await publicQuery(
      `SELECT COUNT(*)::int AS n FROM public.cfmmc_option_trades WHERE trade_date = $1::date`,
      [latestDate],
    )
    if (toCount(n.rows[0]) === 0) return NextResponse.json({ ok: true, rows: [], date: latestDate })
    return NextResponse.json({ ok: true, rows: [], date: latestDate })
  } catch {
    return NextResponse.json({ ok: true, rows: [], date: null })
  }
}

function toCount(row: unknown): number {
  const n = (row as { n?: number } | undefined)?.n
  return typeof n === "number" ? n : 0
}
