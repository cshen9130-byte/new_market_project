import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Ordered tickers + display labels (matches training order)
const ETF_TICKERS = [
  { ticker: "510300.SH", label: "沪深300ETF" },
  { ticker: "510500.SH", label: "中证500ETF" },
  { ticker: "511010.SH", label: "国债ETF" },
  { ticker: "511220.SH", label: "公司债ETF" },
  { ticker: "511880.SH", label: "货币基金ETF" },
  { ticker: "518880.SH", label: "黄金ETF" },
]

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.max(30, Math.min(730, Number(searchParams.get("days") || 365)))

    // Fetch ETF prices
    type EtfRow = { trade_date: Date | string; ticker: string; value: string | null }
    const etfRows = await query<EtfRow>(
      `SELECT trade_date, ticker, value
       FROM raw_etf_daily
       WHERE field = 'ORIGINALUNIT'
         AND ticker = ANY($1)
         AND trade_date >= CURRENT_DATE - ($2::int)
       ORDER BY trade_date ASC`,
      [ETF_TICKERS.map((e) => e.ticker), days],
    )

    // Fetch NHCI prices
    type NhciRow = { trade_date: Date | string; close: string | null }
    const nhciRows = await query<NhciRow>(
      `SELECT trade_date, close
       FROM raw_nhci_daily
       WHERE trade_date >= CURRENT_DATE - ($1::int)
       ORDER BY trade_date ASC`,
      [days],
    )

    // Build {date -> ticker -> price} map for ETFs
    const priceMap: Record<string, Record<string, number>> = {}
    for (const r of etfRows) {
      const d = fmtIso(r.trade_date)
      const v = n(r.value)
      if (v == null) continue
      if (!priceMap[d]) priceMap[d] = {}
      priceMap[d][r.ticker] = v
    }

    // Merge NHCI into the same map
    for (const r of nhciRows) {
      const d = fmtIso(r.trade_date)
      const v = n(r.close)
      if (v == null) continue
      if (!priceMap[d]) priceMap[d] = {}
      priceMap[d]["NHCI"] = v
    }

    const allDates = Object.keys(priceMap).sort()
    if (allDates.length < 2) {
      return NextResponse.json({ data: [] })
    }

    // All assets in display order
    const ALL_ASSETS = [
      ...ETF_TICKERS.map((e) => ({ key: e.ticker, label: e.label })),
      { key: "NHCI", label: "南华商品指数" },
    ]

    // Compute cumulative log returns rebased to 0 at first available day per asset
    const series: Record<string, { date: string; value: number }[]> = {}
    for (const a of ALL_ASSETS) {
      series[a.key] = []
    }

    // Track cumulative log return per asset
    const cumLogRet: Record<string, number> = {}
    const prevPrice: Record<string, number> = {}

    for (const d of allDates) {
      const prices = priceMap[d]
      for (const a of ALL_ASSETS) {
        const price = prices[a.key]
        if (price == null) continue
        if (prevPrice[a.key] == null) {
          // First observation: log return = 0
          cumLogRet[a.key] = 0
        } else {
          const lr = Math.log(price / prevPrice[a.key])
          cumLogRet[a.key] = (cumLogRet[a.key] ?? 0) + lr
        }
        prevPrice[a.key] = price
        // Express as percentage
        series[a.key].push({ date: d, value: parseFloat((cumLogRet[a.key] * 100).toFixed(4)) })
      }
    }

    return NextResponse.json({
      assets: ALL_ASSETS,
      series,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 })
  }
}
