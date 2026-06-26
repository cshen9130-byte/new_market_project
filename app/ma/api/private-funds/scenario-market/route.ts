import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FUTURES_CODES = new Set([
  "NHCI.NH", "NHAI.NH", "NHECI.NH", "NHFI.NH", "NHPMI.NH", "NHNEI.NH", "NHNFI.NH",
])

const STOCK_SYMBOLS = new Set(["IH", "IF", "IC", "IM"])

const LABELS: Record<string, string> = {
  "NHCI.NH": "南华商品指数",
  "NHAI.NH": "南华农产品指数",
  "NHECI.NH": "南华能化指数",
  "NHFI.NH": "南华黑色指数",
  "NHPMI.NH": "南华贵金属指数",
  "NHNEI.NH": "南华新能源指数",
  "NHNFI.NH": "南华有色金属指数",
  IH: "上证50",
  IF: "沪深300",
  IC: "中证500",
  IM: "中证1000",
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const code = sp.get("code") ?? "NHCI.NH"
  const from = sp.get("from") ?? "2020-01-01"
  const to = sp.get("to") ?? new Date().toISOString().slice(0, 10)

  try {
    if (FUTURES_CODES.has(code)) {
      const rows = await query<{
        trade_date: Date | string
        open: string | number | null
        high: string | number | null
        low: string | number | null
        close: string | number | null
      }>(
        `SELECT trade_date, open, high, low, close
         FROM raw_nanhua_indices_daily
         WHERE code = $1
           AND trade_date >= $2
           AND trade_date <= $3
           AND close IS NOT NULL
           AND CAST(close AS float8) > 0
         ORDER BY trade_date ASC`,
        [code, from, to],
      )

      return NextResponse.json({
        ok: true,
        code,
        label: LABELS[code] ?? code,
        assetClass: "futures",
        data: rows.map((row) => ({
          date: fmtIso(row.trade_date),
          open: n(row.open),
          high: n(row.high),
          low: n(row.low),
          close: n(row.close),
        })),
      })
    }

    if (STOCK_SYMBOLS.has(code)) {
      const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
        `SELECT DISTINCT ON (trade_date) trade_date, close
         FROM raw_spot_daily
         WHERE symbol = $1
           AND trade_date >= $2
           AND trade_date <= $3
           AND close IS NOT NULL
           AND close > 0
         ORDER BY trade_date ASC, fetched_at DESC`,
        [code, from, to],
      )

      return NextResponse.json({
        ok: true,
        code,
        label: LABELS[code] ?? code,
        assetClass: "stock",
        data: rows.map((row) => {
          const close = n(row.close)
          return {
            date: fmtIso(row.trade_date),
            open: close,
            high: close,
            low: close,
            close,
          }
        }),
      })
    }

    return NextResponse.json({ ok: false, error: "无效的市场类别代码" }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
