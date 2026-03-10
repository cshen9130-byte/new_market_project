import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query<{
      trade_date: Date
      code: string
      name: string
      sector: string
      return_pct: string
      amount: string
    }>(
      `SELECT trade_date, code, name, sector, return_pct, amount
       FROM raw_commodity_amount_daily
       WHERE trade_date = (SELECT MAX(trade_date) FROM raw_commodity_amount_daily)
       ORDER BY sector, name`
    )
    if (!rows.length) return NextResponse.json({ error: "No data" }, { status: 404 })
    const trade_date = fmtIso(rows[0].trade_date)
    const groups: Record<string, { name: string; children: Array<{ name: string; value: number; ret: number | null }> }> = {}
    let total_amount = 0
    for (const r of rows) {
      const amt = n(r.amount) ?? 0
      const ret = n(r.return_pct)
      total_amount += amt
      const sector = r.sector || "其他"
      if (!groups[sector]) groups[sector] = { name: sector, children: [] }
      groups[sector].children.push({ name: r.name || r.code, value: amt, ret })
    }
    return NextResponse.json({ trade_date, total_amount, data: Object.values(groups) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
