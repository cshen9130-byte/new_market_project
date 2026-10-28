/**
 * Shared MOM NHCI / position as-of freshness for file-cache keys and lag checks.
 *
 * Rolling-vol charts read NHCI via raw_nanhua_indices_daily (benchmark API).
 * Positions / product-nav advance from mom_* settlement tables often hours
 * earlier than EmQuant publishes the same-day NHCI.NH bar. Yesterday's
 * trade-calendar skip fix alone is not enough: mid-day warm caches for
 * benchmark + product-nav were never busted when NHCI caught up, so the
 * "latest day truncated" symptom kept recurring after every afternoon settle.
 *
 * Important: product-nav PnL is driven by mom_daily_reports (plus capital
 * flows), while 持仓截面 can land earlier the same day. A single
 * MAX(daily_reports, position_details) freshness token stays unchanged when
 * daily_reports later catches up to an already-advanced position date — the
 * file cache then keeps serving a product-nav series that ends early. Rolling
 * vol also used that stale product last-date as the NHCI `to`, so BOTH lines
 * stopped early (worse than NHCI-only lag). Track each source separately.
 */

import { query } from "@/lib/db"

export type MomNhciAsOf = {
  /** max(daily_reports, position_details) — used for lag UX vs NHCI. */
  positionAsOf: string | null
  /** Max trade date in mom_daily_reports (product-nav PnL spine). */
  dailyReportsAsOf: string | null
  /** Max trade date in mom_position_details (持仓截面). */
  positionDetailsAsOf: string | null
  /** Max confirmation_date in mom_fund_transactions (capital flows). */
  capitalFlowAsOf: string | null
  nhciAsOf: string | null
  /** Max usable close for NHCI.NH in raw_nanhua_indices_daily (chart source). */
  nanhuaNhciAsOf: string | null
  /** Max usable close in raw_nhci_daily (legacy / quant-vs-subjective). */
  rawNhciAsOf: string | null
}

function isoDate(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return s.slice(0, 10)
}

function maxIso(...dates: Array<string | null | undefined>): string | null {
  let best: string | null = null
  for (const d of dates) {
    const iso = isoDate(d)
    if (!iso) continue
    if (!best || iso > best) best = iso
  }
  return best
}

async function maxDateText(sql: string): Promise<string | null> {
  try {
    const rows = await query<{ d: string | null }>(sql)
    return isoDate(rows[0]?.d)
  } catch {
    return null
  }
}

export async function loadMomNhciAsOf(): Promise<MomNhciAsOf> {
  // Query each source independently so one missing table cannot blank the token.
  const [
    dailyReportsAsOf,
    positionDetailsAsOf,
    capitalFlowAsOf,
    nanhuaNhciAsOf,
    rawNhciAsOf,
  ] = await Promise.all([
    maxDateText(
      `SELECT MAX("交易日期"::date)::text AS d FROM mom_daily_reports WHERE "交易日期" IS NOT NULL`,
    ),
    maxDateText(
      `SELECT MAX("交易日期"::date)::text AS d FROM mom_position_details WHERE "交易日期" IS NOT NULL`,
    ),
    maxDateText(
      `SELECT MAX(confirmation_date::date)::text AS d FROM mom_fund_transactions WHERE confirmation_date IS NOT NULL`,
    ),
    maxDateText(
      `SELECT MAX(trade_date)::text AS d FROM raw_nanhua_indices_daily WHERE code = 'NHCI.NH' AND close IS NOT NULL AND close > 0`,
    ),
    maxDateText(
      `SELECT MAX(trade_date)::text AS d FROM raw_nhci_daily WHERE close IS NOT NULL AND close > 0`,
    ),
  ])

  const nhciAsOf = nanhuaNhciAsOf || rawNhciAsOf
  const positionAsOf = maxIso(dailyReportsAsOf, positionDetailsAsOf)
  return {
    positionAsOf,
    dailyReportsAsOf,
    positionDetailsAsOf,
    capitalFlowAsOf,
    nhciAsOf,
    nanhuaNhciAsOf,
    rawNhciAsOf,
  }
}

/**
 * Cache-key token: advances when any product-nav input OR NHCI settle mid-day.
 * daily_reports / position_details / capital flows are separate so catching up
 * one source after another still busts the file cache.
 */
export async function momNhciFreshnessToken(_req?: Request): Promise<string> {
  const a = await loadMomNhciAsOf()
  return [
    a.dailyReportsAsOf || "",
    a.positionDetailsAsOf || "",
    a.capitalFlowAsOf || "",
    a.nanhuaNhciAsOf || a.rawNhciAsOf || "",
  ].join("_")
}

/** True when product/position as-of is strictly ahead of usable NHCI.NH. */
export function nhciLagsPosition(asOf: MomNhciAsOf): boolean {
  if (!asOf.positionAsOf) return false
  const nhci = asOf.nhciAsOf
  if (!nhci) return true
  return nhci < asOf.positionAsOf
}

export type NhciLagMeta = {
  positionAsOf: string | null
  nhciAsOf: string | null
  nanhuaNhciAsOf: string | null
  dailyReportsAsOf?: string | null
  positionDetailsAsOf?: string | null
  requestedTo: string | null
  lagging: boolean
  /** Human-readable reason when lagging; null when aligned. */
  lagReason: string | null
}

export function buildNhciLagMeta(
  asOf: MomNhciAsOf,
  requestedTo: string | null | undefined,
): NhciLagMeta {
  const to = requestedTo ? String(requestedTo).slice(0, 10) : null
  const seriesEnd = asOf.nhciAsOf
  const lagsPos = nhciLagsPosition(asOf)
  const lagsTo = !!(to && seriesEnd && seriesEnd < to)
  const lagging = lagsPos || lagsTo || (!!to && !seriesEnd)
  let lagReason: string | null = null
  if (lagging) {
    lagReason =
      `NHCI.NH as-of ${seriesEnd || "null"} lags position as-of ${asOf.positionAsOf || "null"}` +
      (to ? ` (requested to=${to})` : "") +
      "; EmQuant same-day settle may still be unpublished, or post-close ETL has not advanced / cache was stale."
  }
  return {
    positionAsOf: asOf.positionAsOf,
    nhciAsOf: seriesEnd,
    nanhuaNhciAsOf: asOf.nanhuaNhciAsOf,
    dailyReportsAsOf: asOf.dailyReportsAsOf,
    positionDetailsAsOf: asOf.positionDetailsAsOf,
    requestedTo: to,
    lagging,
    lagReason,
  }
}
