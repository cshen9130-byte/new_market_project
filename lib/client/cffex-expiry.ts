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

function shanghaiTodayUtc(now = new Date()) {
  const [y, m, d] = shanghaiYmd(now).split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

function daysUntil(expiry: Date, now = new Date()) {
  return Math.round((expiry.getTime() - shanghaiTodayUtc(now)) / 86_400_000)
}

export function nextCffexMonth(year: number, month: number) {
  if (month >= 12) return { year: year + 1, month: 1 }
  return { year, month: month + 1 }
}

export const CFFEX_INDEX_PRODUCTS = ["IH", "IF", "IC", "IM"] as const

function ymCode(year: number, month: number) {
  return `${String(year % 100).padStart(2, "0")}${String(month).padStart(2, "0")}`
}

/** CFFEX stock-index futures: current month, next month, next two quarter months. */
export function listedCffexIndexYms(now = new Date()): Array<[number, number]> {
  const [y, m, d] = shanghaiYmd(now).split("-").map(Number)
  return listedCffexIndexYmsForDate(y, m, d)
}

export function listedCffexIndexYmsForDate(
  year: number,
  month: number,
  day: number,
): Array<[number, number]> {
  let y = year
  let m = month
  if (Date.UTC(year, month - 1, day) > cffexThirdFriday(y, m).getTime()) {
    const rolled = nextCffexMonth(y, m)
    y = rolled.year
    m = rolled.month
  }
  const near: [number, number] = [y, m]
  const nxtMonth = nextCffexMonth(y, m)
  const nxt: [number, number] = [nxtMonth.year, nxtMonth.month]
  const quarterly: Array<[number, number]> = []
  let yy = nxt[0]
  let mm = nxt[1]
  while (quarterly.length < 2) {
    const step = nextCffexMonth(yy, mm)
    yy = step.year
    mm = step.month
    if (mm === 3 || mm === 6 || mm === 9 || mm === 12) quarterly.push([yy, mm])
  }
  return [near, nxt, quarterly[0], quarterly[1]]
}

export function listedCffexIndexContracts(product: string, now = new Date()): string[] {
  const code = product.trim().toUpperCase()
  return listedCffexIndexYms(now).map(([year, month]) => `${code}${ymCode(year, month)}`)
}

export function allListedCffexIndexContracts(now = new Date()): string[] {
  return CFFEX_INDEX_PRODUCTS.flatMap((product) => listedCffexIndexContracts(product, now))
}

/** Calendar expiry still listed (today <= 3rd Friday). */
export function nearestCffexExpiry(now = new Date()) {
  const todayUtc = shanghaiTodayUtc(now)
  const [y, m] = shanghaiYmd(now).split("-").map(Number)
  let year = y
  let month = m
  for (let i = 0; i < 4; i++) {
    const expiry = cffexThirdFriday(year, month)
    if (expiry.getTime() >= todayUtc) return expiry
    const next = nextCffexMonth(year, month)
    year = next.year
    month = next.month
  }
  return cffexThirdFriday(y, m)
}

/**
 * Sina/CTP continuous (*0) follows max-OI. CFFEX index futures roll in the
 * expiry week, so using the literal next 3rd Friday (often 1–3 days) makes
 * annualized basis explode. Use the next month once inside the roll window.
 */
export const CFFEX_ROLL_DAYS = 7

export function dominantCffexExpiry(now = new Date()) {
  const front = nearestCffexExpiry(now)
  if (daysUntil(front, now) > CFFEX_ROLL_DAYS) return front
  const [y, m] = shanghaiYmd(front).split("-").map(Number)
  const next = nextCffexMonth(y, m)
  return cffexThirdFriday(next.year, next.month)
}

export function daysToCffexExpiry(symbol: string, now = new Date()): number | null {
  const parsed = parseIndexFuturesMonth(symbol)
  const expiry = parsed
    ? cffexThirdFriday(parsed.year, parsed.month)
    : /^(IH|IF|IC|IM)0$/i.test(symbol.trim())
      ? dominantCffexExpiry(now)
      : null
  if (!expiry) return null
  return Math.max(1, daysUntil(expiry, now))
}

export function isNearCffexExpiry(symbol: string, now = new Date()) {
  const parsed = parseIndexFuturesMonth(symbol)
  if (!parsed) return false
  const days = daysToCffexExpiry(symbol, now)
  return days != null && days <= CFFEX_ROLL_DAYS
}

export function annualizedBasisPct(futures: number, spot: number, days: number) {
  if (!(futures > 0) || !(spot > 0) || !(days > 0)) return null
  return ((futures - spot) / spot / days) * 365 * 100
}

export function basisPoints(futures: number, spot: number) {
  if (!(futures > 0) || !(spot > 0)) return null
  return futures - spot
}
