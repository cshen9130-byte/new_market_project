import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query<{ trade_date: Date; close: string }>(
      "SELECT trade_date, close FROM raw_nhci_daily ORDER BY trade_date ASC",
    )
    if (!rows.length) return NextResponse.json({ error: "No data" }, { status: 404 })

    const data = rows.map((r) => ({ date: fmtIso(r.trade_date), close: n(r.close) }))
    return NextResponse.json({
      code: "NHCI.NH",
      start: data[0].date,
      end: data[data.length - 1].date,
      data,
      source: "postgresql",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
