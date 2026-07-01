/**
 * Fetch listed-fund (ETF / open-end) NAV from East Money public API.
 * Used when ops_email_nav_records and raw_etf_daily have no data for a code.
 */

import { query } from "@/lib/db"
import { isListedFundCode, listedFundCodeToTickers } from "@/lib/server/fund-holding-code"

export type ListedFundNavDetail = {
  unitNav: number | null
  cumulativeNav: number | null
  navDate: string
  priceChangePct: number | null
}

type EastMoneyLsjzRow = {
  FSRQ?: string
  DWJZ?: string
  LJJZ?: string
  JZZZL?: string
}

function parseJsonBody(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) return JSON.parse(trimmed)
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
  throw new Error("Invalid East Money response")
}

function parsePct(raw: string | undefined): number | null {
  if (raw == null || raw === "" || raw === "--") return null
  const n = parseFloat(String(raw).replace(/%/g, ""))
  return Number.isFinite(n) ? n : null
}

function parseNav(raw: string | undefined): number | null {
  if (raw == null || raw === "" || raw === "--") return null
  const n = parseFloat(String(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchEastMoneyFundNav(code: string, asOfDate: string): Promise<ListedFundNavDetail | null> {
  const url =
    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}`
    + `&pageIndex=1&pageSize=10&startDate=&endDate=`

  const res = await fetch(url, {
    headers: {
      Referer: `https://fund.eastmoney.com/${code}.html`,
      "User-Agent": "Mozilla/5.0 (compatible; MarketDashboard/1.0)",
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return null

  const body = parseJsonBody(await res.text()) as {
    Data?: { LSJZList?: EastMoneyLsjzRow[] }
  }
  const rows = body.Data?.LSJZList ?? []
  if (rows.length === 0) return null

  const picked =
    rows.find((r) => (r.FSRQ ?? "").slice(0, 10) <= asOfDate.slice(0, 10))
    ?? rows[0]
  const unitNav = parseNav(picked.DWJZ)
  if (unitNav == null) return null

  const cumulativeNav = parseNav(picked.LJJZ) ?? unitNav
  const navDate = (picked.FSRQ ?? asOfDate).slice(0, 10)
  const priceChangePct = parsePct(picked.JZZZL)

  return { unitNav, cumulativeNav, navDate, priceChangePct }
}

async function upsertRawEtfDaily(
  code: string,
  detail: ListedFundNavDetail,
): Promise<void> {
  const tickers = listedFundCodeToTickers(code)
  if (tickers.length === 0) return

  const records: Array<[string, string, string, number]> = []
  for (const ticker of tickers) {
    records.push([detail.navDate, ticker, "ORIGINALUNIT", detail.unitNav!])
    if (detail.cumulativeNav != null) {
      records.push([detail.navDate, ticker, "ACCUMULATEDUNIT", detail.cumulativeNav])
    }
  }

  for (const [tradeDate, ticker, field, value] of records) {
    await query(
      `INSERT INTO raw_etf_daily (trade_date, ticker, field, value, source)
       VALUES ($1::date, $2, $3, $4, 'eastmoney')
       ON CONFLICT (trade_date, ticker, field) DO UPDATE
         SET value = EXCLUDED.value, fetched_at = NOW()`,
      [tradeDate, ticker, field, value],
    )
  }
}

export async function fetchListedFundNavBatch(
  codes: string[],
  asOfDate: string,
  options?: { cacheToDb?: boolean },
): Promise<Map<string, ListedFundNavDetail>> {
  const out = new Map<string, ListedFundNavDetail>()
  const listed = [...new Set(codes.filter(isListedFundCode))]
  if (listed.length === 0) return out

  await Promise.all(
    listed.map(async (code) => {
      try {
        const detail = await fetchEastMoneyFundNav(code, asOfDate)
        if (!detail) return
        out.set(code, detail)
        if (options?.cacheToDb !== false) {
          await upsertRawEtfDaily(code, detail).catch(() => {})
        }
      } catch {
        // ignore per-code failures
      }
    }),
  )

  return out
}
