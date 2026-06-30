import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

export { assertCustomFundAccess } from "@/lib/server/custom-funds"

export type CustomFundNavRow = {
  id: string
  nav_date: string
  unit_nav: string
  cumulative_nav: string
  nav_source: string
  created_at: string
}

export type CustomFundNavListRow = CustomFundNavRow & {
  adjusted_nav: string | null
  price_change: string | null
}

function navDir(): string {
  return getServerStoragePath("custom_funds", "nav")
}

function navFile(productCode: string): string {
  return path.join(navDir(), `${productCode.trim()}.json`)
}

function readRawRows(productCode: string): CustomFundNavRow[] {
  mkdirSync(navDir(), { recursive: true })
  const file = navFile(productCode)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRawRows(productCode: string, rows: CustomFundNavRow[]): void {
  mkdirSync(navDir(), { recursive: true })
  writeFileSync(navFile(productCode), JSON.stringify(rows, null, 2))
}

function fmtNav4(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value)
  if (!Number.isFinite(n)) return ""
  return n.toFixed(4)
}

function fmtPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return ""
  const pct = ratio * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(2)}%`
}

function normalizeDate(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (!m) return trimmed
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}


function computeAdjustedSeries(rows: CustomFundNavRow[]): CustomFundNavListRow[] {
  const sorted = [...rows].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
  let reinvested = 1
  let prevUnit: number | null = null

  return sorted.map((row, index) => {
    const unit = parseFloat(row.unit_nav)
    const cumulative = parseFloat(row.cumulative_nav)
    let priceChange: string | null = null
    let adjusted: string | null = null

    if (Number.isFinite(unit) && prevUnit != null && prevUnit > 0) {
      priceChange = fmtPct(unit / prevUnit - 1)
    }

    if (Number.isFinite(unit)) {
      if (index === 0) {
        reinvested = unit
      } else if (prevUnit != null && prevUnit > 0) {
        reinvested *= unit / prevUnit
      }
      adjusted = fmtNav4(reinvested)
      prevUnit = unit
    } else if (Number.isFinite(cumulative)) {
      adjusted = fmtNav4(cumulative)
    }

    return {
      ...row,
      adjusted_nav: adjusted,
      price_change: priceChange,
    }
  }).reverse()
}

export function listCustomFundNavRows(productCode: string): CustomFundNavListRow[] {
  return computeAdjustedSeries(readRawRows(productCode))
}

export type CustomFundNavSeriesPoint = {
  price_date: string
  nav: string
  cumulative_nav: string
  cum_nav_withdrawal: string
  price_change: string
}

export function listCustomFundNavSeries(productCode: string): CustomFundNavSeriesPoint[] {
  return computeAdjustedSeries(readRawRows(productCode))
    .slice()
    .reverse()
    .map((row) => ({
      price_date: row.nav_date,
      nav: row.unit_nav,
      cumulative_nav: row.cumulative_nav,
      cum_nav_withdrawal: row.adjusted_nav ?? row.cumulative_nav,
      price_change: row.price_change?.replace(/[%+]/g, "") ?? "",
    }))
}

/** Headline KPIs for the fund detail header — mirrors private-funds detail API logic. */
export function computeCustomFundHeadlineMetrics(navSeries: CustomFundNavSeriesPoint[]) {
  const empty = {
    ret_since_inception: null as string | null,
    ann_ret: null as string | null,
    ytd_ret: null as string | null,
    max_drawdown: null as string | null,
    sharpe_since_inception: null as string | null,
  }

  if (!navSeries.length) return empty

  const first = navSeries[0]
  const latest = navSeries[navSeries.length - 1]
  const latestReinvestedNav = latest ? parseFloat(latest.cumulative_nav) : null
  const firstReinvestedNav = first ? parseFloat(first.cumulative_nav) : null
  const ret_since_inception =
    latestReinvestedNav !== null && firstReinvestedNav !== null && firstReinvestedNav > 0
      ? latestReinvestedNav / firstReinvestedNav - 1
      : null

  const inceptionDate = first ? new Date(first.price_date) : null
  const latestDate = latest ? new Date(latest.price_date) : null
  const days =
    inceptionDate && latestDate
      ? (latestDate.getTime() - inceptionDate.getTime()) / 86_400_000
      : null

  const ann_ret =
    ret_since_inception !== null && days && days > 0
      ? Math.pow(1 + ret_since_inception, 365 / days) - 1
      : null

  const yearPrefix = latest ? latest.price_date.slice(0, 4) + "-01-01" : null
  const ytdBase = yearPrefix
    ? [...navSeries].reverse().find((r) => r.price_date < yearPrefix) ??
      navSeries.find((r) => r.price_date >= yearPrefix) ??
      null
    : null
  const ytdBaseNav = ytdBase ? parseFloat(ytdBase.cumulative_nav) : null
  const ytd_ret =
    ytdBase && latest && ytdBaseNav !== null && ytdBaseNav > 0 && latestReinvestedNav !== null
      ? latestReinvestedNav / ytdBaseNav - 1
      : null

  let peak = -Infinity
  let maxDrawdown = 0
  const dailyReturns: number[] = []
  for (let i = 0; i < navSeries.length; i++) {
    const v = parseFloat(navSeries[i].cumulative_nav)
    if (!Number.isFinite(v)) continue
    if (v > peak) peak = v
    const dd = peak > 0 ? (peak - v) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
    if (i > 0) {
      const prev = parseFloat(navSeries[i - 1].cumulative_nav)
      if (prev > 0) dailyReturns.push(v / prev - 1)
    }
  }

  let sharpe_since_inception: string | null = null
  if (ann_ret !== null && dailyReturns.length > 1 && days && days > 0) {
    const totalYears = days / 365
    const recordsPerYear = dailyReturns.length / totalYears
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recordsPerYear)
    if (annVol > 0) sharpe_since_inception = (ann_ret / annVol).toFixed(2)
  }

  return {
    ret_since_inception: ret_since_inception !== null ? (ret_since_inception * 100).toFixed(2) : null,
    ann_ret: ann_ret !== null ? (ann_ret * 100).toFixed(2) : null,
    ytd_ret: ytd_ret !== null ? (ytd_ret * 100).toFixed(2) : null,
    max_drawdown: maxDrawdown > 0 ? (maxDrawdown * 100).toFixed(2) : null,
    sharpe_since_inception,
  }
}

export function getCustomFundLatestNav(productCode: string) {
  const rows = listCustomFundNavRows(productCode)
  if (!rows.length) return null
  const latest = rows[0]
  return {
    latest_nav: latest.unit_nav,
    latest_nav_date: latest.nav_date,
    cumulative_nav: latest.cumulative_nav,
    latest_price_change: latest.price_change,
  }
}

type UploadInputRow = {
  nav_date: string
  unit_nav: string
  cumulative_nav?: string
  nav_source?: string
}

export function uploadCustomFundNavRows(
  productCode: string,
  rows: UploadInputRow[],
  navSource = "手工上传",
): { count: number } | { error: "invalid_rows" | "missing_fields" } {
  const code = productCode.trim()
  if (!code || !rows.length) return { error: "missing_fields" }

  const existing = readRawRows(code)
  const byDate = new Map(existing.map((row) => [row.nav_date, row]))
  const now = new Date().toISOString()
  let count = 0

  for (const raw of rows) {
    const nav_date = normalizeDate(raw.nav_date ?? "")
    const unit_nav = String(raw.unit_nav ?? "").trim()
    const cumulative_nav = String(raw.cumulative_nav ?? "").trim() || unit_nav
    if (!nav_date || !unit_nav || !Number.isFinite(parseFloat(unit_nav))) {
      return { error: "invalid_rows" }
    }

    const row: CustomFundNavRow = {
      id: byDate.get(nav_date)?.id ?? randomUUID(),
      nav_date,
      unit_nav: fmtNav4(unit_nav),
      cumulative_nav: fmtNav4(cumulative_nav),
      nav_source: raw.nav_source?.trim() || navSource,
      created_at: byDate.get(nav_date)?.created_at ?? now,
    }
    byDate.set(nav_date, row)
    count += 1
  }

  const merged = Array.from(byDate.values()).sort((a, b) => a.nav_date.localeCompare(b.nav_date))
  writeRawRows(code, merged)
  return { count }
}

export function replaceCustomFundNavRows(
  productCode: string,
  rows: Array<{ nav_date: string; unit_nav: string }>,
  navSource = "规则生成",
): void {
  const code = productCode.trim()
  const now = new Date().toISOString()
  const merged: CustomFundNavRow[] = rows
    .map((row) => {
      const nav_date = normalizeDate(row.nav_date ?? "")
      const unit_nav = String(row.unit_nav ?? "").trim()
      if (!nav_date || !unit_nav || !Number.isFinite(parseFloat(unit_nav))) return null
      const formatted = fmtNav4(unit_nav)
      return {
        id: randomUUID(),
        nav_date,
        unit_nav: formatted,
        cumulative_nav: formatted,
        nav_source: navSource,
        created_at: now,
      }
    })
    .filter((row): row is CustomFundNavRow => row != null)
    .sort((a, b) => a.nav_date.localeCompare(b.nav_date))

  writeRawRows(code, merged)
}

export function clearCustomFundNav(productCode: string): void {
  writeRawRows(productCode.trim(), [])
}

export function deleteCustomFundNavRow(productCode: string, rowId: string): boolean {
  const code = productCode.trim()
  const rows = readRawRows(code)
  const next = rows.filter((row) => row.id !== rowId)
  if (next.length === rows.length) return false
  writeRawRows(code, next)
  return true
}

export function updateCustomFundNavRow(
  productCode: string,
  rowId: string,
  values: UploadInputRow,
): boolean {
  const code = productCode.trim()
  const rows = readRawRows(code)
  const index = rows.findIndex((row) => row.id === rowId)
  if (index < 0) return false

  const nav_date = normalizeDate(values.nav_date ?? "")
  const unit_nav = String(values.unit_nav ?? "").trim()
  const cumulative_nav = String(values.cumulative_nav ?? "").trim() || unit_nav
  if (!nav_date || !unit_nav || !Number.isFinite(parseFloat(unit_nav))) return false

  rows[index] = {
    ...rows[index],
    nav_date,
    unit_nav: fmtNav4(unit_nav),
    cumulative_nav: fmtNav4(cumulative_nav),
  }
  writeRawRows(code, rows.sort((a, b) => a.nav_date.localeCompare(b.nav_date)))
  return true
}
