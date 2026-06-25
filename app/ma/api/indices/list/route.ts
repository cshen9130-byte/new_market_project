import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface IndexCatalogItem {
  code: string
  name: string
  category: string
  source: "spot" | "etf" | "nanhua"
  symbol?: string
  ticker?: string
  inception_date?: string | null
}

const BENCHMARK_INDEX_CATALOG: IndexCatalogItem[] = [
  { code: "IH", name: "上证50", category: "股指", source: "spot", symbol: "IH" },
  { code: "IF", name: "沪深300", category: "股指", source: "spot", symbol: "IF" },
  { code: "IC", name: "中证500", category: "股指", source: "spot", symbol: "IC" },
  { code: "IM", name: "中证1000", category: "股指", source: "spot", symbol: "IM" },
  { code: "000016.SH", name: "上证50指数", category: "股指", source: "spot", symbol: "IH" },
  { code: "000300.SH", name: "沪深300指数", category: "股指", source: "spot", symbol: "IF" },
  { code: "000905.SH", name: "中证500指数", category: "股指", source: "spot", symbol: "IC" },
  { code: "000852.SH", name: "中证1000指数", category: "股指", source: "spot", symbol: "IM" },
  { code: "511010.SH", name: "国债ETF", category: "债券", source: "etf", ticker: "511010.SH" },
  { code: "518880.SH", name: "黄金ETF", category: "商品", source: "etf", ticker: "518880.SH" },
  { code: "NHCI.NH", name: "南华商品指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHAI.NH", name: "南华农产品指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHECI.NH", name: "南华能化指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHFI.NH", name: "南华黑色指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHPMI.NH", name: "南华贵金属指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHNEI.NH", name: "南华新能源指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
  { code: "NHNFI.NH", name: "南华有色金属指数", category: "南华商品", source: "nanhua", inception_date: "2004-06-01" },
]

async function latestSpotPoint(symbol: string) {
  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT trade_date, close
     FROM raw_spot_daily
     WHERE symbol = $1 AND close IS NOT NULL AND close > 0
     ORDER BY trade_date DESC
     LIMIT 1`,
    [symbol],
  )
  const row = rows[0]
  if (!row) return null
  return { date: fmtIso(row.trade_date), point: n(row.close) }
}

async function latestEtfPoint(ticker: string) {
  const rows = await query<{ trade_date: Date | string; value: string | number | null }>(
    `SELECT trade_date, value
     FROM raw_etf_daily
     WHERE ticker = $1 AND field = 'ORIGINALUNIT' AND value IS NOT NULL AND value > 0
     ORDER BY trade_date DESC
     LIMIT 1`,
    [ticker],
  )
  const row = rows[0]
  if (!row) return null
  return { date: fmtIso(row.trade_date), point: n(row.value) }
}

async function latestNanhuaPoint(code: string) {
  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT trade_date, close
     FROM raw_nanhua_indices_daily
     WHERE code = $1 AND close IS NOT NULL AND close > 0
     ORDER BY trade_date DESC
     LIMIT 1`,
    [code],
  )
  const row = rows[0]
  if (!row) return null
  return { date: fmtIso(row.trade_date), point: n(row.close) }
}

async function enrichIndex(item: IndexCatalogItem) {
  let latest: { date: string; point: number | null } | null = null
  try {
    if (item.source === "spot" && item.symbol) latest = await latestSpotPoint(item.symbol)
    else if (item.source === "etf" && item.ticker) latest = await latestEtfPoint(item.ticker)
    else if (item.source === "nanhua") latest = await latestNanhuaPoint(item.code)
  } catch {
    latest = null
  }

  return {
    code: item.code,
    name: item.name,
    category: item.category,
    latest_point: latest?.point != null ? String(latest.point) : null,
    latest_date: latest?.date ?? null,
    inception_date: item.inception_date ?? null,
  }
}

function matchesKeyword(item: IndexCatalogItem, keyword: string) {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return false
  return (
    item.code.toLowerCase().includes(kw)
    || item.name.toLowerCase().includes(kw)
    || item.category.toLowerCase().includes(kw)
  )
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get("category") || "benchmark"
  const keyword = (searchParams.get("keyword") || "").trim()
  const sort = searchParams.get("sort") || "name"
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))

  if (category === "custom") {
    return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 })
  }

  if (!keyword) {
    return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 })
  }

  const matched = BENCHMARK_INDEX_CATALOG.filter((item) => matchesKeyword(item, keyword))
  const enriched = await Promise.all(matched.map(enrichIndex))

  enriched.sort((a, b) => {
    const av =
      sort === "latest_date" ? (a.latest_date ?? "")
      : sort === "inception_date" ? (a.inception_date ?? "")
      : sort === "code" ? a.code
      : sort === "latest_point"
        ? (a.latest_point != null ? parseFloat(a.latest_point) : Number.NEGATIVE_INFINITY)
        : a.name
    const bv =
      sort === "latest_date" ? (b.latest_date ?? "")
      : sort === "inception_date" ? (b.inception_date ?? "")
      : sort === "code" ? b.code
      : sort === "latest_point"
        ? (b.latest_point != null ? parseFloat(b.latest_point) : Number.NEGATIVE_INFINITY)
        : b.name
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av
    }
    const cmp = String(av).localeCompare(String(bv), "zh-CN")
    return dir === "asc" ? cmp : -cmp
  })

  const total = enriched.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  const data = enriched.slice(start, start + pageSize)

  return NextResponse.json({ data, total, page, pageSize, totalPages })
}
