/** CFFEX index futures/options expire on the 3rd Friday of the contract month. */
export function cffexThirdFriday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const mondayBased = (first.getUTCDay() + 6) % 7
  const daysToFirstFri = (4 - mondayBased + 7) % 7
  return new Date(Date.UTC(year, month - 1, 1 + daysToFirstFri + 14))
}

export function parseIndexFuturesMonth(symbol: string) {
  const m = /^(IH|IF|IC|IM)(\d{2})(\d{2})$/i.exec(symbol.trim())
  if (!m) return null
  return { product: m[1].toUpperCase(), year: 2000 + Number(m[2]), month: Number(m[3]) }
}

function shanghaiYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function daysToCffexExpiry(symbol: string, now = new Date()): number | null {
  const parsed = parseIndexFuturesMonth(symbol)
  if (!parsed) return null
  const expiry = cffexThirdFriday(parsed.year, parsed.month)
  const today = shanghaiYmd(now)
  const [y, m, d] = today.split("-").map(Number)
  const todayUtc = Date.UTC(y, m - 1, d)
  return Math.max(1, Math.round((expiry.getTime() - todayUtc) / 86_400_000))
}

export function annualizedBasisPct(futures: number, spot: number, days: number) {
  if (!(futures > 0) || !(spot > 0) || !(days > 0)) return null
  return ((futures - spot) / spot / days) * 365 * 100
}
