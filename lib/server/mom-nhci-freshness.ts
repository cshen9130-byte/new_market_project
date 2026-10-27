/**
 * Shared MOM NHCI / position as-of freshness for file-cache keys and lag checks.
 *
 * Rolling-vol charts read NHCI via raw_nanhua_indices_daily (benchmark API).
 * Positions / product-nav advance from mom_* settlement tables often hours
 * earlier than EmQuant publishes the same-day NHCI.NH bar. Yesterday's
 * trade-calendar skip fix alone is not enough: mid-day warm caches for
 * benchmark + product-nav were never busted when NHCI caught up, so the
 * "latest day truncated" symptom kept recurring after every afternoon settle.
 */

import { query } from "@/lib/db"

export type MomNhciAsOf = {
  positionAsOf: string | null
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

export async function loadMomNhciAsOf(): Promise<MomNhciAsOf> {
  const rows = await query<{
    position_asof: string | null
    nanhua_nhci: string | null
    raw_nhci: string | null
  }>(
    `SELECT
       (SELECT MAX(d)::text FROM (
          SELECT "交易日期"::date AS d FROM mom_daily_reports WHERE "交易日期" IS NOT NULL
          UNION ALL
          SELECT "交易日期"::date AS d FROM mom_position_details WHERE "交易日期" IS NOT NULL
        ) s) AS position_asof,
       (SELECT MAX(trade_date)::text FROM raw_nanhua_indices_daily
         WHERE code = 'NHCI.NH' AND close IS NOT NULL AND close > 0) AS nanhua_nhci,
       (SELECT MAX(trade_date)::text FROM raw_nhci_daily
         WHERE close IS NOT NULL AND close > 0) AS raw_nhci`,
  ).catch(() => [] as Array<{
    position_asof: string | null
    nanhua_nhci: string | null
    raw_nhci: string | null
  }>)

  const positionAsOf = isoDate(rows[0]?.position_asof)
  const nanhuaNhciAsOf = isoDate(rows[0]?.nanhua_nhci)
  const rawNhciAsOf = isoDate(rows[0]?.raw_nhci)
  const nhciAsOf = nanhuaNhciAsOf || rawNhciAsOf
  return { positionAsOf, nhciAsOf, nanhuaNhciAsOf, rawNhciAsOf }
}

/** Cache-key token: advances when positions or NHCI settle mid-day. */
export async function momNhciFreshnessToken(_req?: Request): Promise<string> {
  const a = await loadMomNhciAsOf()
  return `${a.positionAsOf || ""}_${a.nanhuaNhciAsOf || a.rawNhciAsOf || ""}`
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
    requestedTo: to,
    lagging,
    lagReason,
  }
}
