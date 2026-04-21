import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get("date") // YYYY-MM-DD

  try {
    if (date) {
      const rows = await query<{
        row_num: number
        zh_headers: string[]
        en_headers: string[]
        data: Record<string, unknown>
      }>(`
        SELECT row_num, zh_headers, en_headers, data
        FROM guosen_transaction_records
        WHERE settlement_date = $1
        ORDER BY row_num
      `, [date])
      return NextResponse.json({ rows })
    } else {
      // Return distinct dates available
      const dates = await query<{ settlement_date: string }>(`
        SELECT DISTINCT settlement_date::text AS settlement_date
        FROM guosen_transaction_records
        ORDER BY settlement_date DESC
      `)
      return NextResponse.json({ dates: dates.map(d => d.settlement_date) })
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
