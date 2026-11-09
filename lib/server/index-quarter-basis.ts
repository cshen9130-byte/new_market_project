import {
  annualizedBasisPct,
  cffexContractForRole,
  daysToCffexExpiry,
} from "@/lib/client/cffex-expiry"
import { INDEX_FUTURES } from "@/lib/client/ctp-market"
import type { QuarterBasisReading } from "@/lib/index-quarter-basis"
import { getCffexListedQuotes } from "@/lib/server/cffex-listed-quotes"
import { getRollingIndexBasis } from "@/lib/server/index-basis-rate"
import { getIndexSpotLast } from "@/lib/server/index-spot-realtime"

function ymdFromBasisTime(time: number): string {
  const date = new Date(time * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function isoDate(value: string | null | undefined): string {
  const text = (value ?? "").slice(0, 10).replace(/\//g, "-")
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""
}

/** Same 近季 annualized basis the realtime charts print, then the last daily point. */
export async function latestQuarterBasisReadings(): Promise<QuarterBasisReading[]> {
  let spots: Awaited<ReturnType<typeof getIndexSpotLast>> | null = null
  let quotes: Awaited<ReturnType<typeof getCffexListedQuotes>> | null = null
  try {
    ;[spots, quotes] = await Promise.all([getIndexSpotLast(), getCffexListedQuotes()])
  } catch (error) {
    console.warn("[index-quarter-basis] live quotes failed", error)
  }

  const readings: QuarterBasisReading[] = []
  for (const item of INDEX_FUTURES) {
    const symbol = cffexContractForRole(item.product, "quarter")
    const quote = quotes?.quotes[symbol]
    const spot = spots?.[item.product]
    const days = daysToCffexExpiry(symbol)
    const live = quote?.last != null && spot?.price != null && days != null
      ? annualizedBasisPct(quote.last, spot.price, days)
      : null
    const liveDate = isoDate(quote?.trade_date) || isoDate(spot?.date)
    if (live != null && liveDate) {
      readings.push({ product: item.product, name: item.name, date: liveDate, value: live })
      continue
    }
    const roles = await getRollingIndexBasis(item.product)
    const last = roles?.quarter.at(-1)
    if (!last) continue
    readings.push({
      product: item.product,
      name: item.name,
      date: ymdFromBasisTime(last.time),
      value: last.value,
    })
  }
  return readings
}
