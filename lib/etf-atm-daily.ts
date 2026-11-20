/**
 * Daily at-the-money implied vol for one ETF option expiry, or the rolling
 * front month. This is the purple line on a contract chart: the average of
 * the call and put closest to that day's underlying close, not QVIX.
 */

const RATE = 0.018

export type DayClose = { date: string; close: number }

export type AtmStrikeBook = {
  strike: number
  call: DayClose[]
  put: DayClose[]
}

export type AtmMonthBook = {
  yymm: string
  expireDay: string
  strikes: AtmStrikeBook[]
}

export type AtmDailyPoint = { date: string; close: number; yymm: string; strike: number }

/** SSE and SZSE ETF options expire on the 4th Wednesday of the contract month. */
export function sseEtfExpiryDay(yymm: string): string | null {
  if (!/^\d{4}$/.test(yymm)) return null
  const year = 2000 + Number(yymm.slice(0, 2))
  const month = Number(yymm.slice(2))
  if (month < 1 || month > 12) return null
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysToWed = (3 - first.getUTCDay() + 7) % 7
  const day = 1 + daysToWed + 21
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}`
}

function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x)
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

function bsPrice(spot: number, strike: number, tenor: number, sigma: number, side: "call" | "put") {
  if (!(tenor > 0) || !(sigma > 0) || !(spot > 0) || !(strike > 0)) {
    return side === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)
  }
  const sqrtT = Math.sqrt(tenor)
  const d1 = (Math.log(spot / strike) + (RATE + 0.5 * sigma * sigma) * tenor) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const df = Math.exp(-RATE * tenor)
  if (side === "call") return spot * normCdf(d1) - strike * df * normCdf(d2)
  return strike * df * normCdf(-d2) - spot * normCdf(-d1)
}

function impliedVolPercent(price: number, spot: number, strike: number, tenor: number, side: "call" | "put") {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(tenor > 0)) return null
  const intrinsic = side === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)
  if (price < intrinsic * 0.99) return null
  const gap = (sigma: number) => bsPrice(spot, strike, tenor, sigma, side) - price
  let lo = 1e-4
  let hi = 5
  if (gap(lo) * gap(hi) > 0) return null
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (gap(mid) > 0) hi = mid
    else lo = mid
  }
  const pct = ((lo + hi) / 2) * 100
  if (pct < 1 || pct > 150) return null
  return pct
}

function yearFraction(date: string, expireDay: string) {
  const start = Date.parse(`${date}T15:00:00Z`)
  const end = Date.parse(`${expireDay}T15:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 7 / 365
  return Math.max(end - start, 30 * 60 * 1000) / (365 * 24 * 3600 * 1000)
}

function byDate(rows: DayClose[]) {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0) map.set(row.date, row.close)
  }
  return map
}

/**
 * One point per underlying session.
 * `month` null keeps the nearest expiry that is still alive that day.
 * A yymm keeps that expiry on every day it has not yet expired.
 */
export function buildAtmDailyBars(input: {
  spot: DayClose[]
  months: AtmMonthBook[]
  month: string | null
}): AtmDailyPoint[] {
  const books = input.months
    .filter((item) => /^\d{4}$/.test(item.yymm) && /^\d{4}-\d{2}-\d{2}$/.test(item.expireDay))
    .map((item) => ({
      yymm: item.yymm,
      expireDay: item.expireDay,
      strikes: item.strikes
        .filter((strike) => strike.strike > 0)
        .map((strike) => ({
          strike: strike.strike,
          call: byDate(strike.call),
          put: byDate(strike.put),
        })),
    }))
    .filter((item) => item.strikes.length > 0)
  const points: AtmDailyPoint[] = []
  const spot = [...input.spot].filter((row) => row.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  for (const row of spot) {
    const alive = books.filter((item) => item.expireDay >= row.date && (input.month == null || item.yymm === input.month))
    alive.sort((a, b) => a.expireDay.localeCompare(b.expireDay) || a.yymm.localeCompare(b.yymm))
    const month = alive[0]
    if (!month) continue
    const tenor = yearFraction(row.date, month.expireDay)
    const ranked = [...month.strikes].sort((a, b) => Math.abs(a.strike - row.close) - Math.abs(b.strike - row.close))
    for (const strike of ranked) {
      const callPx = strike.call.get(row.date)
      const putPx = strike.put.get(row.date)
      if (callPx == null || putPx == null) continue
      const callIv = impliedVolPercent(callPx, row.close, strike.strike, tenor, "call")
      const putIv = impliedVolPercent(putPx, row.close, strike.strike, tenor, "put")
      if (callIv == null || putIv == null) continue
      const mid = (callIv + putIv) / 2
      if (Math.abs(callIv - putIv) > Math.max(8, mid * 0.35)) continue
      points.push({
        date: row.date,
        close: Math.round(mid * 100) / 100,
        yymm: month.yymm,
        strike: strike.strike,
      })
      break
    }
  }
  if (points.length < 2) return points
  return points.filter((point, index) => {
    const dayGap = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000
    const left = index > 0 ? dayGap(points[index - 1]!.date, point.date) : Infinity
    const right = index < points.length - 1 ? dayGap(point.date, points[index + 1]!.date) : Infinity
    return left <= 12 || right <= 12
  })
}
