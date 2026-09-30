import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"
import {
  CCIDX_COMMODITY_INDEX_LABEL,
  loadCcidxCommodityIndexPrices,
} from "@/lib/server/ccidx-commodity-index"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BENCHMARKS = {
  IH: { label: "上证50", source: "spot" as const, symbol: "IH" },
  IF: { label: "沪深300", source: "spot" as const, symbol: "IF" },
  IC: { label: "中证500", source: "spot" as const, symbol: "IC" },
  IM: { label: "中证1000", source: "spot" as const, symbol: "IM" },
  "000001.SH": { label: "上证指数", source: "ashare" as const, tsCode: "000001.SH" },
  "000906.SH": { label: "中证800", source: "ashare" as const, tsCode: "000906.SH" },
  "000903.SH": { label: "中证100", source: "ashare" as const, tsCode: "000903.SH" },
  "000688.SH": { label: "科创50", source: "ashare" as const, tsCode: "000688.SH" },
  "000510.SH": { label: "中证A500", source: "ashare" as const, tsCode: "000510.SH" },
  "000985.SH": { label: "中证全指", source: "ashare" as const, tsCode: "000985.SH" },
  "000902.SH": { label: "中证流通", source: "ashare" as const, tsCode: "000902.SH" },
  "000832.SH": { label: "中证转债", source: "ashare" as const, tsCode: "000832.SH" },
  "H11006.CSI": { label: "中证国债", source: "ashare" as const, tsCode: "H11006.CSI" },
  "399303.SZ": { label: "国证2000", source: "ashare" as const, tsCode: "399303.SZ" },
  "000922.SH": { label: "中证红利", source: "ashare" as const, tsCode: "000922.SH" },
  "899050.BJ": { label: "北证50", source: "ashare" as const, tsCode: "899050.BJ" },
  "HSI.HI": { label: "恒生指数", source: "ashare" as const, tsCode: "HSI.HI" },
  "H00300.CSI": { label: "沪深300全收益", source: "ashare" as const, tsCode: "H00300.CSI" },
  "511010.SH": { label: "国债ETF", source: "etf" as const, ticker: "511010.SH" },
  "518880.SH": { label: "黄金ETF", source: "etf" as const, ticker: "518880.SH" },
  "NHCI.NH": { label: "南华商品指数", source: "nanhua" as const, code: "NHCI.NH" },
  "100001.CCI": { label: CCIDX_COMMODITY_INDEX_LABEL, source: "ccidx" as const },
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

    if (meta.source === "ccidx") {
      const data = await loadCcidxCommodityIndexPrices(from, to)
      return NextResponse.json({
        ok: true,
        key,
        label: meta.label,
        data,
      })
    }


    if (meta.source === "ashare") {
      const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
        `SELECT trade_date, close
         FROM raw_ashare_index_daily
         WHERE ts_code = $1
           AND trade_date >= $2
           AND trade_date <= $3
           AND close IS NOT NULL
           AND close > 0
         ORDER BY trade_date ASC`,
        [meta.tsCode, from, to],
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