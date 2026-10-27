import { describe, expect, it } from "vitest"
import { allWeatherPositionDailyPnl } from "@/lib/client/all-weather-nav"

describe("allWeatherPositionDailyPnl after close", () => {
  it("prefers locked book daily PnL when the live mark equals prevPrice", () => {
    // Sunday / after-bell: markOf returns prev (flat), book still holds the day.
    const row = {
      symbol: "IF2611",
      lots: 1,
      multiplier: 300,
      prevPrice: 4000,
      price: 4050,
      bookDaily: 15000,
      dailyPnl: 15000,
    }
    const markOf = (_symbol: string | undefined, fallback: number) => row.prevPrice
    const pnl = allWeatherPositionDailyPnl(row, markOf, new Date("2026-10-27T10:00:00+08:00"))
    // 10:00 Shanghai is before CFFEX open on a weekday... use after close.
    const afterClose = allWeatherPositionDailyPnl(row, markOf, new Date("2026-10-27T16:00:00+08:00"))
    expect(afterClose).toBe(15000)
  })

  it("uses live mark-to-prev during the session", () => {
    const row = {
      symbol: "IF2611",
      lots: 1,
      multiplier: 300,
      prevPrice: 4000,
      price: 4050,
      bookDaily: 15000,
      dailyPnl: 15000,
    }
    const markOf = () => 4060
    // Tue 10:00 Shanghai — CFFEX morning session
    const pnl = allWeatherPositionDailyPnl(row, markOf, new Date("2026-10-27T10:00:00+08:00"))
    expect(pnl).toBe((4060 - 4000) * 300)
  })
})
