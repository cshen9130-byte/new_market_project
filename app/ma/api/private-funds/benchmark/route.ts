import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BENCHMARKS = {
  IH: { label: "上证50", source: "spot", symbol: "IH" },
  IF: { label: "沪深300", source: "spot", symbol: "IF" },
  IC: { label: "中证500", source: "spot", symbol: "IC" },
  IM: { label: "中证1000", source: "spot", symbol: "IM" },
  "511010.SH": { label: "国债ETF", source: "etf", ticker: "511010.SH" },
  "518880.SH": { label: "黄金ETF", source: "etf", ticker: "518880.SH" },
  "NHCI.NH": { label: "南华商品指数", source: "nanhua", code: "NHCI.NH" },
} as const

type BenchmarkKey = keyof typeof BENCHMARKS

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const key = sp.get("key") as BenchmarkKey | null
  const from = sp.get("from") || "2020-01-01"
  const to = sp.get("to") || new Date().toISOString().slice(0, 10)

  if (!key || !(key in BENCHMARKS)) {
    return NextResponse.json({ ok: false, error: "无效的基准代码" }, { status: 400 })
  }

  const meta = BENCHMARKS[key]

  try {
    if (meta.source === "spot") {
      const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
        `SELECT DISTINCT ON (trade_date) trade_date, close
         FROM raw_spot_daily
         WHERE symbol = $1
           AND trade_date >= $2
           AND trade_date <= $3
           AND close IS NOT NULL
           AND close > 0
         ORDER BY trade_date ASC, fetched_at DESC`,
        [meta.symbol, from, to],
      )

      return NextResponse.json({
        ok: true,
        key,
        label: meta.label,
        data: rows
          .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
          .filter((row): row is { date: string; value: number } => row.value !== null),
      })
    }

    if (meta.source === "etf") {
      const rows = await query<{ trade_date: Date | string; value: string | number | null }>(
        `SELECT trade_date, value
         FROM raw_etf_daily
         WHERE ticker = $1
           AND field = 'ORIGINALUNIT'
           AND trade_date >= $2
           AND trade_date <= $3
           AND value IS NOT NULL
           AND value > 0
         ORDER BY trade_date ASC`,
        [meta.ticker, from, to],
      )

      return NextResponse.json({
        ok: true,
        key,
        label: meta.label,
        data: rows
          .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.value) }))
          .filter((row): row is { date: string; value: number } => row.value !== null),
      })
    }

    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT trade_date, close
       FROM raw_nanhua_indices_daily
       WHERE code = $1
         AND trade_date >= $2
         AND trade_date <= $3
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC`,
      [meta.code, from, to],
    )

    return NextResponse.json({
      ok: true,
      key,
      label: meta.label,
      data: rows
        .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
        .filter((row): row is { date: string; value: number } => row.value !== null),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}