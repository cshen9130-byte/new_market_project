import type { MarketEvent, MarketEventSeries } from "@/lib/ma/market-event-calendar-shared"

/** Monthly US CPI and non-farm payrolls. Fed meetings and other prints stay off the bell. */
const BELL_SERIES = new Set<MarketEventSeries>(["cpi", "nfp"])

export function isUsMacroBellCandidate(event: MarketEvent): boolean {
  return event.region === "US" && BELL_SERIES.has(event.series)
}

/** Lower is a better headline when several prints share one Beijing day. */
function headlineRank(event: MarketEvent): number {
  const title = event.title
  if (event.series === "cpi") {
    if (/核心/.test(title)) return 2
    if (/环比/.test(title)) return 1
    return 0
  }
  if (event.series === "nfp") return /非农/.test(title) ? 0 : 1
  return 0
}

const SERIES_ORDER: MarketEventSeries[] = ["cpi", "nfp"]

/**
 * One bell item per series on the Beijing calendar day of the release.
 * Callers pass events whose `date` and `time` are already Beijing.
 */
export function marketBellEventsForDay(events: readonly MarketEvent[], beijingDate: string): MarketEvent[] {
  const day = beijingDate.slice(0, 10)
  const grouped = new Map<MarketEventSeries, MarketEvent>()
  for (const event of events) {
    if (event.date.slice(0, 10) !== day || !isUsMacroBellCandidate(event)) continue
    const previous = grouped.get(event.series)
    if (!previous || headlineRank(event) < headlineRank(previous)) grouped.set(event.series, event)
  }
  return SERIES_ORDER.flatMap((series) => {
    const event = grouped.get(series)
    return event ? [event] : []
  })
}

export function usMacroBellDedupeKey(series: string, beijingDate: string): string {
  return `us_macro_market_day:${series}:${beijingDate.slice(0, 10)}`
}

export function usMacroBellMessage(event: MarketEvent): { title: string; body: string; href: string } {
  const clock = event.time ? `北京时间 ${event.time} 公布。` : "今天公布。"
  return {
    title: event.title,
    body: `${clock}${event.summary}`,
    href: "/ma/dashboard/event-calendar",
  }
}
