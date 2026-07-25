import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"
import {
  COMMODITY_KEY_TO_LABEL,
  COMMODITY_KEY_TO_RANK,
  COMMODITY_KEY_TO_SECTOR,
  COMMODITY_KEY_TO_SHORT,
  commoditySectorForKey,
  commodityShortName,
} from "@/lib/commodity-option-meta"
import { underlyingCnLabel } from "@/lib/option-iv-labels"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface SnapshotRow {
  trade_date: Date | string
  underlying_key: string
  label: string
  sector: string | null
  current_iv: string | number | null
  percentile_all: string | number | null
  percentile_1y: string | number | null
  chart_data: Record<string, unknown> | string
}

interface IvHistoryRow {
  underlying_key: string
  trade_date: Date | string
  iv: string | number | null
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

const SECTOR_RANK: Record<string, number> = {
  农产品: 10,
  黑色: 20,
  有色: 30,
  能化: 40,
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

function canonicalLabel(key: string, fallback?: string | null): string {
  return COMMODITY_KEY_TO_LABEL[key] ?? underlyingCnLabel(key, fallback ?? key)
}

function canonicalSector(key: string, fallback?: string | null): string {
  return COMMODITY_KEY_TO_SECTOR[key] ?? fallback ?? ""
}

/** Percentile rank of the last value within the series (0–100). */
function percentileRank(values: number[]): number | null {
  if (values.length < 2) return values.length === 1 ? 50 : null
  const last = values[values.length - 1]
  let below = 0
  for (const v of values) {
    if (v <= last) below += 1
  }
  return Math.round((below / values.length) * 1000) / 10
}

function buildHistoryPercentiles(rows: IvHistoryRow[]): Record<string, {
  percentile_all: number | null
  percentile_1y: number | null
  history: Array<{ trade_date: string; iv: number }>
}> {
  const byKey = new Map<string, Array<{ trade_date: string; iv: number }>>()
  for (const row of rows) {
    const iv = n(row.iv)
    if (iv == null) continue
    const td = fmtIso(row.trade_date)
    const list = byKey.get(row.underlying_key) ?? []
    list.push({ trade_date: td, iv })
    byKey.set(row.underlying_key, list)
  }

  const out: Record<string, {
    percentile_all: number | null
    percentile_1y: number | null
    history: Array<{ trade_date: string; iv: number }>
  }> = {}

  for (const [key, series] of byKey) {
    series.sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    const ivs = series.map((p) => p.iv)
    const cutoff = series[series.length - 1]?.trade_date
    let y1 = ivs
    if (cutoff && cutoff.length >= 10) {
      const y1Start = new Date(cutoff)
      y1Start.setFullYear(y1Start.getFullYear() - 1)
      const y1Iso = y1Start.toISOString().slice(0, 10)
      y1 = series.filter((p) => p.trade_date >= y1Iso).map((p) => p.iv)
    }
    out[key] = {
      percentile_all: percentileRank(ivs),
      percentile_1y: percentileRank(y1),
      history: series,
    }
  }
  return out
}

function buildSummary(underlyings: Record<string, Record<string, unknown>>): SummaryGroupRow[] {
  const items = Object.values(underlyings).map((u) => {
    const key = String(u.key)
    const iv = n(u.current_iv as string | number | null)
    const pct = n(u.percentile_all as string | number | null)
    const sector = canonicalSector(key, String(u.sector ?? u.group ?? ""))
    const label = canonicalLabel(key, String(u.label ?? key))
    const short = commodityShortName(key, String(u.short_label ?? label))
    const row: SummaryGroupRow & { sector: string; rank: number } = {
      group_label: label,
      keys: [key],
      iv_display: iv != null ? `约 ${iv.toFixed(0)}%` : "—",
      percentile: pct,
      percentile_display: pct != null ? `约 ${pct.toFixed(0)}%` : null,
      products: [{
        key,
        label: short,
        current_iv: iv,
        percentile_all: pct,
      }],
      sector,
      rank: COMMODITY_KEY_TO_RANK[key] ?? 999,
    }
    return row
  })

  items.sort((a, b) => {
    const sa = SECTOR_RANK[a.sector] ?? 999
    const sb = SECTOR_RANK[b.sector] ?? 999
    if (sa !== sb) return sa - sb
    return a.rank - b.rank
  })

  return items.map(({ sector: _s, rank: _r, ...row }) => row)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const underlying = searchParams.get("underlying")

  try {
    // Always take the newest snapshot per product so a partial same-day refresh
    // (e.g. Sina-only DCE) does not hide earlier SHFE/CZCE rows.
    const effectiveRows = await query<SnapshotRow>(
      `SELECT DISTINCT ON (underlying_key)
              trade_date, underlying_key, label, sector,
              current_iv, percentile_all, percentile_1y, chart_data
       FROM derived_commodity_option_iv_snapshot
       ORDER BY underlying_key, trade_date DESC`,
    )
    if (!effectiveRows.length) {
      return NextResponse.json({ error: "No commodity option IV data" }, { status: 404 })
    }

    const tradeDate = effectiveRows
      .map((r) => fmtIso(r.trade_date))
      .sort()
      .at(-1)!

    const histRows = await query<IvHistoryRow>(
      `SELECT underlying_key, trade_date, iv
       FROM raw_commodity_option_iv_daily
       WHERE iv IS NOT NULL
       ORDER BY underlying_key, trade_date`,
    )
    const histByKey = buildHistoryPercentiles(histRows)

    if (underlying) {
      const row = effectiveRows.find((r) => r.underlying_key === underlying)
      if (!row) {
        return NextResponse.json({ error: "Underlying not found" }, { status: 404 })
      }
      const payload = parseChartData(row.chart_data)
      const key = row.underlying_key
      const hist = histByKey[key]
      const charts = (payload.charts as Record<string, unknown> | undefined) ?? {}
      if (hist?.history?.length) {
        charts.history = hist.history
        charts.percentile = {
          latest_iv: hist.history[hist.history.length - 1]?.iv ?? null,
          percentile_all: hist.percentile_all,
          percentile_1y: hist.percentile_1y,
          series: hist.history.map((p) => ({
            trade_date: p.trade_date,
            iv: p.iv,
            percentile_all: hist.percentile_all,
            percentile_1y: hist.percentile_1y,
          })),
        }
      }
      return NextResponse.json({
        trade_date: fmtIso(row.trade_date),
        ...payload,
        charts,
        key,
        label: canonicalLabel(key, row.label),
        short_label: COMMODITY_KEY_TO_SHORT[key] ?? commodityShortName(key),
        sector: commoditySectorForKey(key, row.sector),
        group: commoditySectorForKey(key, row.sector),
        current_iv: n(row.current_iv) ?? n((payload as { current_iv?: unknown }).current_iv as never),
        percentile_all: hist?.percentile_all ?? n(row.percentile_all),
        percentile_1y: hist?.percentile_1y ?? n(row.percentile_1y),
      })
    }

    const underlyings: Record<string, Record<string, unknown>> = {}
    for (const row of effectiveRows) {
      const payload = parseChartData(row.chart_data)
      const key = row.underlying_key
      const label = canonicalLabel(key, row.label)
      const sector = canonicalSector(key, row.sector)
      const hist = histByKey[key]
      const charts = (payload.charts as Record<string, unknown> | undefined) ?? {}
      if (hist?.history?.length) {
        charts.history = hist.history
        charts.percentile = {
          latest_iv: hist.history[hist.history.length - 1]?.iv ?? null,
          percentile_all: hist.percentile_all,
          percentile_1y: hist.percentile_1y,
          series: hist.history.map((p) => ({
            trade_date: p.trade_date,
            iv: p.iv,
            percentile_all: hist.percentile_all,
            percentile_1y: hist.percentile_1y,
          })),
        }
      }
      underlyings[key] = {
        ...payload,
        key,
        label,
        short_label: COMMODITY_KEY_TO_SHORT[key] ?? commodityShortName(key, label),
        sector,
        group: sector,
        current_iv: n(row.current_iv),
        percentile_all: hist?.percentile_all ?? n(row.percentile_all),
        percentile_1y: hist?.percentile_1y ?? n(row.percentile_1y),
        charts,
      }
    }

    return NextResponse.json({
      trade_date: tradeDate,
      summary: buildSummary(underlyings),
      underlyings,
      product_count: Object.keys(underlyings).length,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
