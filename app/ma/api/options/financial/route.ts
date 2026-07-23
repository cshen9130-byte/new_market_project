import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"
import { underlyingCnLabel } from "@/lib/option-iv-labels"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface SnapshotRow {
  trade_date: Date | string
  underlying_key: string
  label: string
  group_label: string | null
  spot: string | number | null
  current_iv: string | number | null
  percentile_all: string | number | null
  percentile_1y: string | number | null
  chart_data: Record<string, unknown> | string
}

interface SummaryGroupRow {
  group_label: string
  keys: string[]
  iv_display: string
  percentile: number | null
  percentile_display: string | null
  products: Array<{
    key: string
    label: string
    current_iv: number | null
    percentile_all: number | null
  }>
}

function parseChartData(raw: SnapshotRow["chart_data"]): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return raw
}

function percentileSummary(pcts: number[]): { display: string | null; rating: number | null } {
  if (!pcts.length) return { display: null, rating: null }
  const lo = Math.min(...pcts)
  const hi = Math.max(...pcts)
  if (hi - lo < 5) {
    const val = Math.round(lo * 10) / 10
    return { display: `约 ${val.toFixed(0)}%`, rating: val }
  }
  return { display: `${lo.toFixed(0)}% - ${hi.toFixed(0)}%`, rating: Math.round(hi * 10) / 10 }
}

function buildSummary(underlyings: Record<string, Record<string, unknown>>): SummaryGroupRow[] {
  const groups: Array<[string, string[]]> = [
    ["科创50 ETF期权", ["kcb", "kcb_efund"]],
    ["创业板 ETF期权", ["cyb"]],
    ["深证100 ETF期权", ["100etf"]],
    ["中证500 ETF期权", ["500etf", "500etf_sz"]],
    ["中证1000 股指期权", ["1000index"]],
    ["沪深300 股指/ETF期权", ["300index", "300etf", "300etf_sz"]],
    ["上证50 ETF/股指期权", ["50etf", "50index"]],
  ]

  return groups
    .map(([groupLabel, keys]) => {
      const items = keys
        .map((k) => underlyings[k])
        .filter(Boolean) as Array<Record<string, unknown>>

      if (!items.length) return null

      const ivs = items
        .map((u) => n(u.current_iv as string | number | null))
        .filter((v): v is number => v != null)
      const pcts = items
        .map((u) => n(u.percentile_all as string | number | null))
        .filter((v): v is number => v != null)

      let ivDisplay = "—"
      if (ivs.length) {
        const lo = Math.min(...ivs)
        const hi = Math.max(...ivs)
        ivDisplay = hi - lo < 0.5 ? `约 ${lo.toFixed(0)}%` : `${lo.toFixed(0)}% - ${hi.toFixed(0)}%`
      }

      const { display: pctDisplay, rating: pctRating } = percentileSummary(pcts)

      return {
        group_label: groupLabel,
        keys,
        iv_display: ivDisplay,
        percentile: pctRating,
        percentile_display: pctDisplay,
        products: items.map((u) => ({
          key: String(u.key),
          label: underlyingCnLabel(String(u.key), String(u.label ?? u.key)),
          current_iv: n(u.current_iv as string | number | null),
          percentile_all: n(u.percentile_all as string | number | null),
        })),
      }
    })
    .filter((row): row is SummaryGroupRow => row != null)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const underlying = searchParams.get("underlying")

  try {
    const latestRows = await query<{ trade_date: Date | string }>(
      `SELECT MAX(trade_date) AS trade_date FROM raw_option_iv_qvix_daily`,
    )
    const latestDate = latestRows[0]?.trade_date
    if (!latestDate) {
      return NextResponse.json({ error: "No financial option IV data" }, { status: 404 })
    }

    const tradeDate = fmtIso(latestDate)

    if (underlying) {
      const rows = await query<SnapshotRow>(
        `SELECT trade_date, underlying_key, label, group_label, spot,
                current_iv, percentile_all, percentile_1y, chart_data
         FROM derived_option_iv_snapshot
         WHERE trade_date = $1 AND underlying_key = $2`,
        [tradeDate, underlying],
      )
      if (!rows.length) {
        return NextResponse.json({ error: "Underlying not found" }, { status: 404 })
      }
      const row = rows[0]
      const payload = parseChartData(row.chart_data)
      return NextResponse.json({
        trade_date: tradeDate,
        ...payload,
      })
    }

    const rows = await query<SnapshotRow>(
      `SELECT trade_date, underlying_key, label, group_label, spot,
              current_iv, percentile_all, percentile_1y, chart_data
       FROM derived_option_iv_snapshot
       WHERE trade_date = $1
       ORDER BY underlying_key`,
      [tradeDate],
    )

    const underlyings: Record<string, Record<string, unknown>> = {}
    for (const row of rows) {
      const payload = parseChartData(row.chart_data)
      underlyings[row.underlying_key] = {
        key: row.underlying_key,
        label: row.label,
        group: row.group_label,
        spot: n(row.spot),
        current_iv: n(row.current_iv),
        percentile_all: n(row.percentile_all),
        percentile_1y: n(row.percentile_1y),
        ...payload,
      }
    }

    return NextResponse.json({
      trade_date: tradeDate,
      summary: buildSummary(underlyings),
      underlyings,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
