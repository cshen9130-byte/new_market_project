import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const INDEXES = [
  { code: "NHAI.NH", name: "南华农产品指数" },
  { code: "NHECI.NH", name: "南华能化指数" },
  { code: "NHFI.NH", name: "南华黑色指数" },
  { code: "NHPMI.NH", name: "南华贵金属指数" },
  { code: "NHNEI.NH", name: "南华新能源指数" },
  { code: "NHNFI.NH", name: "南华有色金属指数" },
] as const

type IndexCode = (typeof INDEXES)[number]["code"]

export async function GET() {
  try {
    const lastYear = new Date().getFullYear() - 1
    const since = `${lastYear}-01-01`
    const codes = INDEXES.map((item) => item.code)
    const rows = await query<{ trade_date: Date | string; code: IndexCode; close: string | number | null }>(
      `SELECT trade_date, code, close
       FROM raw_nanhua_indices_daily
       WHERE trade_date >= $1
         AND code = ANY($2::text[])
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC, code ASC`,
      [since, codes],
    )

    if (!rows.length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    const grouped = new Map<IndexCode, Array<{ date: string; close: number | null }>>()
    for (const { code } of INDEXES) {
      grouped.set(code, [])
    }

    for (const row of rows) {
      const bucket = grouped.get(row.code)
      if (!bucket) continue
      bucket.push({
        date: fmtIso(row.trade_date),
        close: n(row.close),
      })
    }

    const series = INDEXES.map(({ code, name }) => ({
      code,
      name,
      data: grouped.get(code) ?? [],
    })).filter((item) => item.data.length > 0)

    if (!series.length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    const dates = Array.from(
      new Set(series.flatMap((item) => item.data.map((point) => point.date))),
    ).sort()

    return NextResponse.json({
      start: dates[0],
      end: dates[dates.length - 1],
      series,
      source: "postgresql",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}