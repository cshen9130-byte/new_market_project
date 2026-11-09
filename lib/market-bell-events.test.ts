import assert from "node:assert/strict"
import test from "node:test"
import { listMarketEvents } from "./ma/market-event-calendar"
import type { MarketEvent } from "./ma/market-event-calendar-shared"
import { marketBellEventsForDay, usMacroBellDedupeKey, usMacroBellMessage } from "./market-bell-events"

function event(partial: Pick<MarketEvent, "series" | "region" | "title" | "date" | "time"> & Partial<MarketEvent>): MarketEvent {
  return {
    id: partial.id ?? partial.title,
    date: partial.date,
    time: partial.time,
    region: partial.region,
    category: partial.category ?? "通胀",
    series: partial.series,
    officialDate: partial.officialDate ?? partial.date,
    title: partial.title,
    summary: partial.summary ?? "summary",
    markets: partial.markets ?? [],
    impact: partial.impact ?? "high",
  }
}

function bellsInMonth(yearMonth: string, lastDay: number): string[] {
  const [year, month] = yearMonth.split("-")
  const from = `${yearMonth}-01`
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`
  const events = listMarketEvents({ from, to })
  const keys: string[] = []
  for (let day = 1; day <= lastDay; day += 1) {
    const iso = `${year}-${month}-${String(day).padStart(2, "0")}`
    for (const item of marketBellEventsForDay(events, iso)) keys.push(`${item.date}:${item.series}`)
  }
  return keys
}

test("November CPI is belled on the Beijing day at 21:30, and the day before stays quiet", () => {
  const events = listMarketEvents({ from: "2026-11-09", to: "2026-11-10" })
  assert.equal(marketBellEventsForDay(events, "2026-11-09").length, 0)
  const day = marketBellEventsForDay(events, "2026-11-10")
  assert.equal(day.length, 1)
  assert.equal(day[0].series, "cpi")
  assert.equal(day[0].time, "21:30")
  assert.match(usMacroBellMessage(day[0]).body, /北京时间 21:30/)
  assert.equal(usMacroBellDedupeKey("cpi", "2026-11-10"), "us_macro_market_day:cpi:2026-11-10")
})

test("each month bells non-farm payrolls and CPI once, and skips Fed meetings", () => {
  assert.deepEqual(bellsInMonth("2026-11", 30), ["2026-11-06:nfp", "2026-11-10:cpi"])
  assert.deepEqual(bellsInMonth("2026-12", 31), ["2026-12-04:nfp", "2026-12-10:cpi"])
})

test("one US headline per series, and China CPI stays off the bell", () => {
  const picked = marketBellEventsForDay([
    event({ series: "fomc", region: "US", title: "美联储利率决议", date: "2026-12-10", time: "03:00" }),
    event({ series: "cpi", region: "US", title: "美国10月核心CPI同比", date: "2026-11-10", time: "21:30" }),
    event({ series: "cpi", region: "CN", title: "中国10月CPI同比", date: "2026-11-10", time: "09:30" }),
    event({ series: "cpi", region: "US", title: "美国10月CPI同比", date: "2026-11-10", time: "21:30" }),
    event({ series: "nfp", region: "US", title: "美国10月失业率", date: "2026-11-06", time: "21:30" }),
    event({ series: "nfp", region: "US", title: "美国10月非农就业", date: "2026-11-06", time: "21:30" }),
  ], "2026-11-10")
  assert.equal(picked.length, 1)
  assert.equal(picked[0].title, "美国10月CPI同比")
  const nfp = marketBellEventsForDay([
    event({ series: "nfp", region: "US", title: "美国10月失业率", date: "2026-11-06", time: "21:30" }),
    event({ series: "nfp", region: "US", title: "美国10月非农就业", date: "2026-11-06", time: "21:30" }),
  ], "2026-11-06")
  assert.equal(nfp.length, 1)
  assert.equal(nfp[0].title, "美国10月非农就业")
})
