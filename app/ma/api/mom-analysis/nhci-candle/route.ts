import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from")
    const to   = searchParams.get("to")
    const code = searchParams.get("code") || "NHCI.NH"

    const params: unknown[] = [code]
    const conditions = [`code = $1`]

    if (from) {
      params.push(from)
      conditions.push(`trade_date >= $${params.length}::date`)
    }
    if (to) {
      params.push(to)
      conditions.push(`trade_date <= $${params.length}::date`)
    }

    const sql = `
      SELECT
        trade_date::text                   AS date,
        CAST(open      AS float8)          AS open,
        CAST(high      AS float8)          AS high,
        CAST(low       AS float8)          AS low,
        CAST(close     AS float8)          AS close,
        CAST(COALESCE(volume, 0) AS float8) AS volume
      FROM raw_nanhua_indices_daily
      WHERE ${conditions.join(" AND ")}
      ORDER BY trade_date ASC
    `

    const rows = await query<{
      date: string
      open: number
      high: number
      low: number
      close: number
      volume: number
    }>(sql, params.length > 0 ? params : undefined)

    return NextResponse.json({ ok: true, data: rows })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
