import fs from "fs"
import path from "path"

import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import {
  mergeLegacyWithTeamNav,
  mergeNavSeriesWithEmail,
  type EmailNavPoint,
  type LegacyNavRow,
} from "@/lib/server/email-nav-query"

type ManagedNavSeedFile = {
  beian_hao: string
  before_date: string
  rows: LegacyNavRow[]
}

export type NavHistoryPoint = { nav_date: string; nav: number }

const seedCache = new Map<string, LegacyNavRow[]>()
const MIN_RISK_POINTS = 20
const MAX_PLAUSIBLE_RATIO = 50

export function isPlausibleRiskRatio(
  value: number | null | undefined,
  maxAbs = MAX_PLAUSIBLE_RATIO,
): value is number {
  return value != null && Number.isFinite(value) && Math.abs(value) <= maxAbs
}

/** Team/email unit NAV may only override seed on dates after the verified reference ends. */
export function buildTeamUnitOverlayAfterSeed(
  seedRows: LegacyNavRow[],
  teamSeries: LegacyNavRow[],
): Array<{ price_date: string; nav: string; cumulative_nav: null; adjusted_nav: null }> {
  const seedLatest = seedRows.length > 0 ? seedRows[seedRows.length - 1].price_date : ""
  return teamSeries
    .filter((row) => !seedLatest || row.price_date > seedLatest)
    .map((row) => ({
      price_date: row.price_date,
      nav: row.nav,
      cumulative_nav: null,
      adjusted_nav: null,
    }))
}

/**
 * Detail-page NAV for 在管产品 with a verified xlsx seed.
 * Seed is authoritative through its last date; team/email may extend after that.
 * Post-seed email is merged against the seed base so cumulative/adj rechains from the
 * verified tail — never finalized in isolation (which loses unit/cum context).
 * Legacy rows within or after the seed window are dropped so corrupt DB points cannot leak in.
 */
export function mergeManagedProductDetailNav(
  seedRows: LegacyNavRow[],
  teamEmailPoints: EmailNavPoint[],
  legacyRows: LegacyNavRow[],
): LegacyNavRow[] {
  if (seedRows.length === 0) {
    const teamRows = mergeNavSeriesWithEmail([], teamEmailPoints)
    return mergeLegacyWithTeamNav(legacyRows, teamRows)
  }

  const seedStart = seedRows[0].price_date
  const seedLatest = seedRows[seedRows.length - 1].price_date
  const extensionPoints = teamEmailPoints.filter((row) => row.price_date > seedLatest)
  const legacyBeforeSeed = legacyRows.filter((row) => row.price_date < seedStart)
  const seedBase = mergeLegacyWithTeamNav(
    legacyBeforeSeed,
    mergeNavSeriesWithEmail(seedRows, []),
  )

  return mergeNavSeriesWithEmail(seedBase, extensionPoints)
}

/** Latest verified seed point on or before asOfDate (only within seed file coverage). */
export function resolveManagedProductSeedNavAt(
  beianHao: string,
  asOfDate: string,
): { nav: string; nav_date: string; prev_nav: string | null } | null {
  const seed = loadManagedProductNavSeed(beianHao)
  if (seed.length === 0) return null

  const seedLatest = seed[seed.length - 1].price_date
  let bestIdx = -1
  for (let i = 0; i < seed.length; i++) {
    if (seed[i].price_date <= asOfDate) bestIdx = i
    else break
  }
  if (bestIdx < 0) return null

  const best = seed[bestIdx]
  if (best.price_date > seedLatest) return null

  const prev = bestIdx > 0 ? seed[bestIdx - 1].nav : null
  return { nav: best.nav, nav_date: best.price_date, prev_nav: prev }
}

/** Reference NAV rows from verified xlsx. */
export function loadManagedProductNavSeed(beianHao: string): LegacyNavRow[] {
  const key = (beianHao ?? "").trim().toUpperCase()
  if (!key) return []
  const cached = seedCache.get(key)
  if (cached) return cached

  const seedPath = path.join(process.cwd(), "data", "managed-product-nav", `${key}.json`)
  if (!fs.existsSync(seedPath)) return []

  try {
    const raw = JSON.parse(fs.readFileSync(seedPath, "utf8")) as ManagedNavSeedFile
    const rows = (raw.rows ?? []).map((row) => ({ ...row }))
    seedCache.set(key, rows)
    return rows
  } catch (err) {
    console.error("[loadManagedProductNavSeed]", err)
    return []
  }
}

/** 1Y Sharpe / Calmar from 复权净值; optional unit overlay rechains derived fields. */
export function computeManagedProductOneYearRiskMetrics(
  beianHao: string,
  navDate: string | null,
  unitHistory: NavHistoryPoint[] = [],
): { sharpe_1y: number | null; calmar_1y: number | null } {
  const seed = loadManagedProductNavSeed(beianHao)
  if (seed.length === 0) return { sharpe_1y: null, calmar_1y: null }

  let series = seed
  if (unitHistory.length > 0) {
    series = mergeNavSeriesWithEmail(
      seed,
      unitHistory.map((p) => ({
        price_date: p.nav_date,
        nav: String(p.nav),
        cumulative_nav: null,
        adjusted_nav: null,
      })),
    )
  }

  const refDate = navDate
    ? new Date(navDate)
    : new Date(series[series.length - 1].price_date)
  const cutoffTs = refDate.getTime() - 365 * 86400000

  const dates: string[] = []
  const values: number[] = []
  for (const row of series) {
    const ts = new Date(row.price_date).getTime()
    const v = parseFloat(row.cumulative_nav)
    if (ts >= cutoffTs && ts <= refDate.getTime() && Number.isFinite(v) && v > 0) {
      dates.push(row.price_date)
      values.push(v)
    }
  }

  if (dates.length < MIN_RISK_POINTS) return { sharpe_1y: null, calmar_1y: null }

  const metrics = computeFundNavMetrics({ dates, values })
  if (!metrics) return { sharpe_1y: null, calmar_1y: null }

  return {
    sharpe_1y: isPlausibleRiskRatio(metrics.sharpe)
      ? Math.round(metrics.sharpe * 10000) / 10000
      : null,
    calmar_1y: isPlausibleRiskRatio(metrics.calmar)
      ? Math.round(metrics.calmar * 10000) / 10000
      : null,
  }
}
