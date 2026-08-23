import { assetFromContract } from "@/lib/all-weather/universe"
import { CFFEX_BOND_PRODUCTS, CFFEX_INDEX_PRODUCTS } from "@/lib/client/cffex-expiry"

const CFFEX = new Set<string>([...CFFEX_INDEX_PRODUCTS, ...CFFEX_BOND_PRODUCTS])

function shanghaiParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)
  const hhmm = Number(parts.hour) * 100 + Number(parts.minute)
  return { weekday: weekday < 0 ? now.getDay() : weekday, hhmm }
}

function inRange(hhmm: number, start: number, end: number) {
  return hhmm >= start && hhmm <= end
}

/** CFFEX 股指/国债：仅工作日日盘。 */
export function isCffexSession(now = new Date()) {
  const { weekday, hhmm } = shanghaiParts(now)
  if (weekday === 0 || weekday === 6) return false
  return inRange(hhmm, 930, 1130) || inRange(hhmm, 1300, 1515)
}

/** 夜盘收盘（次日 hhmm）。未列出的商品按 23:00，避免收盘后还去跟 last。 */
const NIGHT_TO_0230 = new Set(["AU", "AG", "SC"])
const NIGHT_TO_0100 = new Set(["CU", "AL", "ZN", "PB", "NI", "SN", "AO", "BC", "SS", "LC"])

function nightEndHhmm(symbol?: string) {
  const asset = symbol
    ? assetFromContract(symbol) || symbol.replace(/\d+$/i, "").toUpperCase()
    : ""
  if (NIGHT_TO_0230.has(asset)) return 230
  if (NIGHT_TO_0100.has(asset)) return 100
  return 2300
}

/**
 * 国内商品：周日全天休市。夜盘只在周一至周五晚上，周五夜盘跨到周六凌晨后收市到周一早盘。
 */
export function isCommoditySession(now = new Date(), symbol?: string) {
  const { weekday, hhmm } = shanghaiParts(now)
  const nightEnd = nightEndHhmm(symbol)
  if (weekday >= 1 && weekday <= 5 && hhmm >= 2100) {
    return nightEnd >= 2300 ? hhmm <= nightEnd : true
  }
  if (nightEnd < 2100 && weekday >= 2 && weekday <= 6 && inRange(hhmm, 0, nightEnd)) return true
  if (weekday === 0 || weekday === 6) return false
  return inRange(hhmm, 900, 1015) || inRange(hhmm, 1030, 1130) || inRange(hhmm, 1330, 1500)
}

export function isCffexProduct(symbol: string) {
  const asset = assetFromContract(symbol) || symbol.replace(/\d+$/i, "").toUpperCase()
  return CFFEX.has(asset)
}

export function isLiveSessionFor(symbol: string, now = new Date()) {
  return isCffexProduct(symbol) ? isCffexSession(now) : isCommoditySession(now, symbol)
}

export function validMark(n: number | null | undefined) {
  return n != null && Number.isFinite(n) && n > 0 ? n : null
}

export function quoteOf<T>(quotes: Record<string, T>, symbol: string): T | null {
  return quotes[symbol] || quotes[symbol.toUpperCase()] || quotes[symbol.toLowerCase()] || null
}

/** Keep the first closed-session mark. Only follow new prints while that product is in session. */
export function mergeClosedMarks(prev: Record<string, number>, incoming: Record<string, number>) {
  const next = { ...prev }
  let changed = false
  for (const [sym, px] of Object.entries(incoming)) {
    if (!validMark(px)) continue
    const key = sym.toUpperCase()
    if (!isLiveSessionFor(key) && validMark(next[key])) continue
    if (next[key] !== px) {
      next[key] = px
      changed = true
    }
  }
  return changed ? next : prev
}
