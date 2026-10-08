import { calendarDaysToCffexExpiry, listedCffexIndexContracts } from "@/lib/client/cffex-expiry"
import { INDEX_FUTURES } from "@/lib/client/ctp-market"
import { isCffexSession, shanghaiYmd } from "@/lib/client/market-hours"
import { getCffexListedQuotes } from "@/lib/server/cffex-listed-quotes"
import { getIndexSpotLast } from "@/lib/server/index-spot-realtime"

const ROLES = ["近月", "次月", "当季", "下季"] as const

export type LiveDiscountPoint = {
  date: string
  annualized_discount_pct: number
  days_to_maturity: number
  spot_close: number
  futures_settle: number
}

export type LiveDiscountPayload = {
  date: string
  session: boolean
  roles: Record<string, Record<string, LiveDiscountPoint>>
}

function shanghaiHhmm(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return Number(parts.hour) * 100 + Number(parts.minute)
}

/** Weekday from the cash open onward, so the last print still fills today after the close. */
export function cffexDiscountWindow(now = new Date()) {
  const [year, month, day] = shanghaiYmd(now).split("-").map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return shanghaiHhmm(now) >= 930
}

export async function getLiveDiscount(now = new Date()): Promise<LiveDiscountPayload> {
  const today = shanghaiYmd(now)
  const session = isCffexSession(now)
  if (!cffexDiscountWindow(now)) return { date: today, session, roles: {} }

  const [spots, listed] = await Promise.all([getIndexSpotLast(), getCffexListedQuotes()])
  const roles: LiveDiscountPayload["roles"] = {}

  for (const item of INDEX_FUTURES) {
    const spot = spots[item.product]
    if (!spot || spot.price == null || !(spot.price > 0)) continue
    if (spot.date && spot.date !== today) continue
    const spotPx = spot.price
    const roleSeries: Record<string, LiveDiscountPoint> = {}
    listedCffexIndexContracts(item.product, now).forEach((symbol, idx) => {
      const role = ROLES[idx]
      if (!role) return
      const quote = listed.quotes[symbol.toUpperCase()]
      if (!quote || quote.last == null || !(quote.last > 0)) return
      if (quote.trade_date && quote.trade_date !== today) return
      const fut = quote.last
      const days = calendarDaysToCffexExpiry(symbol, now)
      if (days == null || days <= 1) return
      const ann = ((spotPx - fut) / spotPx / days) * 365 * 100
      if (!Number.isFinite(ann)) return
      roleSeries[role] = {
        date: today,
        annualized_discount_pct: ann,
        days_to_maturity: days,
        spot_close: spotPx,
        futures_settle: fut,
      }
    })
    if (Object.keys(roleSeries).length) roles[item.product] = roleSeries
  }

  return { date: today, session, roles }
}
