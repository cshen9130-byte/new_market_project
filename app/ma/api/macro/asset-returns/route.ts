import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"
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

type AssetPoint = { date: string; value: number }
type PeriodReturn = {
  key: string
  label: string
  date: string | null
  value: number | null
}

type PredictionRow = {
  cluster: number | string | null
  pc1: string | null
  pc2: string | null
}

type LoadingRow = {
  asset: string
  label: string
  pc1: number
  pc2: number
}

const VALID_FREQS = ["daily", "weekly", "monthly"] as const
type Freq = typeof VALID_FREQS[number]

const LOADINGS_TO_ASSET_KEY: Record<string, string> = {
  "510300.SH_ORIGINALUNIT": "510300.SH",
  "510500.SH_ORIGINALUNIT": "510500.SH",
  "511010.SH_ORIGINALUNIT": "511010.SH",
  "511220.SH_ORIGINALUNIT": "511220.SH",
  "511880.SH_ORIGINALUNIT": "511880.SH",
  "518880.SH_ORIGINALUNIT": "518880.SH",
  "NHCI.NH_CLOSE": "NHCI",
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.max(1, Math.min(730, Number(searchParams.get("days") || 365)))
    const freqParam = searchParams.get("freq") ?? "daily"
    const freq: Freq = VALID_FREQS.includes(freqParam as Freq) ? (freqParam as Freq) : "daily"
    const rawLookbackDays = days <= 1 ? 10 : days

    // Fetch ETF prices
    type EtfRow = { trade_date: Date | string; ticker: string; value: string | null }
    const etfRows = await query<EtfRow>(
      `SELECT trade_date, ticker, value
       FROM raw_etf_daily
       WHERE field = 'ORIGINALUNIT'
         AND ticker = ANY($1)
         AND trade_date >= CURRENT_DATE - ($2::int)
       ORDER BY trade_date ASC`,
      [ETF_TICKERS.map((e) => e.ticker), rawLookbackDays],
    )

    // Fetch NHCI prices
    type NhciRow = { trade_date: Date | string; close: string | null }
    const nhciRows = await query<NhciRow>(
      `SELECT trade_date, close
       FROM raw_nhci_daily
       WHERE trade_date >= CURRENT_DATE - ($1::int)
       ORDER BY trade_date ASC`,
      [rawLookbackDays],
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
      return NextResponse.json({
        assets: [],
        series: {},
        latest_returns: [],
        period_returns: [],
        period_label: days <= 1 ? "当日" : `近${days}天`,
        favored_asset_key: null,
      })
    }

    // All assets in display order
    const ALL_ASSETS = [
      ...ETF_TICKERS.map((e) => ({ key: e.ticker, label: e.label })),
      { key: "NHCI", label: "南华商品指数" },
    ]

    // Compute cumulative log returns rebased to 0 at first available day per asset
    const series: Record<string, AssetPoint[]> = {}
    for (const a of ALL_ASSETS) {
      series[a.key] = []
    }

    // Track cumulative log return per asset
    const cumLogRet: Record<string, number> = {}
    const prevPrice: Record<string, number> = {}
    const latestReturns: Record<string, PeriodReturn> = {}
    const firstPrice: Record<string, number> = {}
    const lastPrice: Record<string, number> = {}
    const lastDate: Record<string, string> = {}

    for (const asset of ALL_ASSETS) {
      latestReturns[asset.key] = {
        key: asset.key,
        label: asset.label,
        date: null,
        value: null,
      }
    }

    for (const d of allDates) {
      const prices = priceMap[d]
      for (const a of ALL_ASSETS) {
        const price = prices[a.key]
        if (price == null) continue
        if (firstPrice[a.key] == null) firstPrice[a.key] = price
        if (prevPrice[a.key] == null) {
          // First observation: log return = 0
          cumLogRet[a.key] = 0
        } else {
          const lr = Math.log(price / prevPrice[a.key])
          cumLogRet[a.key] = (cumLogRet[a.key] ?? 0) + lr
          latestReturns[a.key] = {
            key: a.key,
            label: a.label,
            date: d,
            value: parseFloat((((price / prevPrice[a.key]) - 1) * 100).toFixed(4)),
          }
        }
        prevPrice[a.key] = price
        lastPrice[a.key] = price
        lastDate[a.key] = d
        // Express as percentage
        series[a.key].push({ date: d, value: parseFloat((cumLogRet[a.key] * 100).toFixed(4)) })
      }
    }

    const periodReturns: PeriodReturn[] = ALL_ASSETS.map((asset) => {
      const startPrice = firstPrice[asset.key]
      const endPrice = lastPrice[asset.key]
      if (startPrice == null || endPrice == null || lastDate[asset.key] == null) {
        return { key: asset.key, label: asset.label, date: null, value: null }
      }

      const value =
        days <= 1
          ? latestReturns[asset.key]?.value ?? null
          : parseFloat((((endPrice / startPrice) - 1) * 100).toFixed(4))

      return {
        key: asset.key,
        label: asset.label,
        date: lastDate[asset.key],
        value,
      }
    })

    let favoredAssetKeys: string[] = []
    const favoredAssetStars: Record<string, 1 | 2 | 3> = {}
    const latestPrediction = await query<PredictionRow>(
      `SELECT cluster, pc1, pc2
       FROM current_market_prediction
       WHERE freq = $1
       ORDER BY trade_date DESC
       LIMIT 1`,
      [freq],
    )

    const latestPc1 = n(latestPrediction[0]?.pc1 ?? null)
    const latestPc2 = n(latestPrediction[0]?.pc2 ?? null)

    if (latestPc1 != null && latestPc2 != null) {
      const loadingsPath = path.join(process.cwd(), "data", "pca_loadings.json")
      const raw = fs.readFileSync(loadingsPath, "utf-8")
      const parsed = JSON.parse(raw) as { loadings?: LoadingRow[] }
      const scored = (parsed.loadings ?? [])
        .map((loading) => ({
          key: LOADINGS_TO_ASSET_KEY[loading.asset],
          score: latestPc1 * loading.pc1 + latestPc2 * loading.pc2,
        }))
        .filter((item) => !!item.key)
        .sort((a, b) => b.score - a.score)
      // Include all assets whose dot-product with the current PC direction is positive
      const positiveScored = scored.filter((item) => item.score > 0)
      favoredAssetKeys = positiveScored.map((item) => item.key)
      const maxScore = positiveScored.length > 0 ? positiveScored[0].score : 1
      for (const item of positiveScored) {
        const ratio = item.score / maxScore
        favoredAssetStars[item.key] = ratio >= 0.67 ? 3 : ratio >= 0.33 ? 2 : 1
      }
    }

    const periodLabel = days <= 1 ? "当日" : `近${days}天`

    return NextResponse.json({
      assets: ALL_ASSETS,
      series,
      latest_returns: ALL_ASSETS.map((asset) => latestReturns[asset.key]),
      period_returns: periodReturns,
      period_label: periodLabel,
      favored_asset_keys: favoredAssetKeys,
      favored_asset_stars: favoredAssetStars,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 })
  }
}
