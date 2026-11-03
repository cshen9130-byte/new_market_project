/**
 *   npx tsx --test lib/client/qvix-series.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { barsOnLastTradeDay } from "./timeframes"
import { chartWindowForSeries, intradayAxisEnd, ivReturnScale, omitIsolatedNulls, padIntradayLookback, padIntradaySeries, plotOnVisibleWindow, previousSessionClose, quoteAxisEnd, qvixBarsForTimeframe, returnBaseline, sliceOverlayByLookbackDays, sliceSeriesToWindow } from "./qvix-series"

function unix(y: number, m: number, d: number, h = 0, min = 0) {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000)
}

describe("qvix bars for timeframe", () => {
  const minute = Array.from({ length: 30 }, (_, i) => ({
    time: unix(2026, 10, 20, 9, 30) + i * 60,
    close: 10 + i,
  }))
  const live = { bars: minute, source: "optbbs:300etf", value: minute.at(-1)!.close }

  it("keeps the 1-minute series", () => {
    const out = qvixBarsForTimeframe("1m", live, [])
    assert.equal(out.mode, "intraday")
    assert.equal(out.bars.length, minute.length)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("aggregates intraday closes and keeps the latest print", () => {
    const out = qvixBarsForTimeframe("15m", live, [])
    assert.equal(out.mode, "intraday")
    assert.ok(out.bars.length > 1)
    assert.ok(out.bars.length < minute.length)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("treats a Sina near-month ATM series as intraday", () => {
    const out = qvixBarsForTimeframe("1m", { ...live, source: "sina-atm:300etf" }, [])
    assert.equal(out.mode, "intraday")
    assert.equal(out.bars.length, minute.length)
  })

  it("does not invent an intraday line from a daily fallback", () => {
    const out = qvixBarsForTimeframe(
      "5m",
      { bars: [{ time: unix(2026, 10, 17, 15, 0), close: 18 }, { time: unix(2026, 10, 20, 15, 0), close: 19 }], source: "db:300etf", value: 19 },
      [],
    )
    assert.equal(out.mode, "unavailable")
    assert.equal(out.bars.length, 0)
  })

  it("stamps the live minute close onto today's daily bar", () => {
    const daily = [
      { time: unix(2026, 10, 17, 15, 0), close: 18 },
      { time: unix(2026, 10, 20, 15, 0), close: 19 },
    ]
    const out = qvixBarsForTimeframe("1d", live, daily)
    assert.equal(out.mode, "history")
    assert.equal(out.bars.length, 2)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("rolls daily history into weeks", () => {
    const daily = [13, 14, 15, 16, 17, 20].map((day, i) => ({
      time: unix(2026, 10, day, 15, 0),
      close: 18 + i,
    }))
    const out = qvixBarsForTimeframe("1w", { bars: [], source: null, value: null }, daily)
    assert.equal(out.mode, "history")
    assert.ok(out.bars.length >= 1)
    assert.ok(out.bars.length < daily.length)
    assert.equal(out.bars.at(-1)?.close, 23)
  })
})

describe("sliceOverlayByLookbackDays", () => {
  it("keeps only the last N distinct Shanghai days", () => {
    const bars = [
      { time: unix(2026, 10, 27, 10, 0), close: 1 },
      { time: unix(2026, 10, 28, 10, 0), close: 2 },
      { time: unix(2026, 10, 28, 11, 0), close: 3 },
      { time: unix(2026, 10, 29, 10, 0), close: 4 },
      { time: unix(2026, 10, 30, 9, 30), close: 5 },
      { time: unix(2026, 10, 30, 10, 0), close: 6 },
    ]
    const out = sliceOverlayByLookbackDays(bars, 2)
    assert.equal(out.length, 3)
    assert.equal(out[0].close, 4)
    assert.equal(out.at(-1)?.close, 6)
  })

  it("limits to the latest session when days is 1", () => {
    const bars = [
      { time: unix(2026, 10, 29, 15, 0), close: 4 },
      { time: unix(2026, 10, 30, 9, 30), close: 5 },
      { time: unix(2026, 10, 30, 10, 0), close: 6 },
    ]
    const out = sliceOverlayByLookbackDays(bars, 1)
    assert.equal(out.length, 2)
    assert.equal(out[0].close, 5)
  })
})

describe("padIntradayLookback", () => {
  it("starts a 2-day axis at the previous Friday open when only Monday is stored", () => {
    const bars = [
      { time: unix(2026, 11, 2, 9, 30), close: 38 },
      { time: unix(2026, 11, 2, 9, 31), close: 38.2 },
    ]
    const out = padIntradayLookback(bars, 2)
    assert.equal(out[0]?.time, unix(2026, 10, 30, 9, 30))
    assert.equal(out[0]?.close, null)
    assert.equal(out.at(-1)?.time, unix(2026, 11, 2, 9, 31))
    assert.equal(out.at(-1)?.close, 38.2)
    const monday = out.find((bar) => bar.time === unix(2026, 11, 2, 9, 30))
    assert.equal(monday?.close, 38)
    const friday = out.filter((bar) => new Date(bar.time * 1000).getUTCDate() === 30)
    assert.equal(friday.length, 242)
    assert.ok(friday.every((bar) => bar.close == null))
    assert.equal(out.length, 244)
    assert.equal(out.some((bar) => new Date(bar.time * 1000).getUTCDate() === 31), false)
    assert.equal(out.some((bar) => new Date(bar.time * 1000).getUTCDate() === 1), false)
  })

  it("places 13:00 on the same slot when one series ends earlier", () => {
    const end = unix(2026, 11, 2, 13, 25)
    const full = [
      { time: unix(2026, 11, 2, 9, 30), close: 21 },
      { time: unix(2026, 11, 2, 13, 0), close: 21.3 },
      { time: unix(2026, 11, 2, 13, 25), close: 21.4 },
    ]
    const short = [
      { time: unix(2026, 11, 2, 9, 30), close: 39 },
      { time: unix(2026, 11, 2, 13, 12), close: 39.3 },
    ]
    const a = padIntradayLookback(full, 1, end)
    const b = padIntradayLookback(short, 1, end)
    const at = (series: Array<{ time: number }>) => series.findIndex((bar) => bar.time === unix(2026, 11, 2, 13, 0))
    assert.equal(a.length, b.length)
    assert.equal(at(a), 121)
    assert.equal(at(b), at(a))
    assert.equal(b.at(-1)?.close, null)
    assert.equal(a.at(-1)?.close, 21.4)
  })
})

describe("omitIsolatedNulls", () => {
  it("joins the empty 13:00 minute and keeps a longer hole", () => {
    const plot = [
      { close: 39 },
      { close: null },
      { close: 38.5 },
      { close: null },
      { close: null },
      { close: null },
      { close: 38 },
    ]
    const out = omitIsolatedNulls(plot)
    assert.deepEqual(out.map((bar) => bar.close), [39, 38.5, null, null, null, 38])
  })
})

describe("previous session close", () => {
  it("uses the last print of the session before the latest day", () => {
    const bars = [
      { time: unix(2026, 10, 30, 14, 59), close: 39.2 },
      { time: unix(2026, 10, 30, 15, 0), close: 40.31 },
      { time: unix(2026, 11, 2, 9, 31), close: 41.8 },
      { time: unix(2026, 11, 2, 14, 30), close: 38.3 },
    ]
    assert.equal(previousSessionClose(bars), 40.31)
  })

  it("stays empty when the series is only today", () => {
    const bars = [
      { time: unix(2026, 11, 2, 9, 31), close: 41.8 },
      { time: unix(2026, 11, 2, 14, 30), close: 38.3 },
    ]
    assert.equal(previousSessionClose(bars), null)
  })

  it("keeps yesterday's print and ignores an older day that is not the previous session", () => {
    const mondayAndTuesday = [
      { time: unix(2026, 11, 2, 15, 0), close: 21.32 },
      { time: unix(2026, 11, 3, 10, 30), close: 21.26 },
    ]
    assert.equal(returnBaseline(mondayAndTuesday, 21.79), 21.32)
    const fridayAndTuesday = [
      { time: unix(2026, 10, 30, 15, 0), close: 40.31 },
      { time: unix(2026, 11, 3, 10, 30), close: 38.63 },
    ]
    assert.equal(returnBaseline(fridayAndTuesday, 38.2), 38.2)
    const todayOnly = [{ time: unix(2026, 11, 3, 10, 30), close: 15.36 }]
    assert.equal(returnBaseline(todayOnly, 15.49), 15.49)
  })
})

describe("iv return scale", () => {
  it("centers the percent ticks on yesterday when that close is inside the range", () => {
    const scale = ivReturnScale(36.5, 44, 40.31)
    assert.ok(scale)
    assert.equal(scale.rightMin, -scale.rightMax)
    assert.ok(scale.rightMin < 0 && scale.rightMax > 0)
    assert.ok(Math.abs(scale.leftMin - 40.31 * (1 + scale.rightMin / 100)) < 1e-9)
    assert.ok(scale.leftMin < 36.5 && scale.leftMax > 44)
  })

  it("keeps zero in the middle when the session is entirely above yesterday", () => {
    const scale = ivReturnScale(20.7, 22.5, 20.22)
    assert.ok(scale)
    assert.equal(scale.rightMin, -scale.rightMax)
    assert.ok(scale.rightMax > 0)
    assert.ok(scale.leftMin < 20.22 && scale.leftMax > 22.5)
  })
})

describe("intradayAxisEnd", () => {
  it("uses the Shanghai minute during the afternoon session", () => {
    const end = intradayAxisEnd(new Date("2026-11-02T05:25:00Z"))
    assert.equal(end, unix(2026, 11, 2, 13, 25))
  })

  it("stops at 11:30 through the lunch break", () => {
    const end = intradayAxisEnd(new Date("2026-11-02T04:10:00Z"))
    assert.equal(end, unix(2026, 11, 2, 11, 30))
  })
})

describe("intraday frequency keeps the session window", () => {
  it("drops older sessions when the last print is today", () => {
    const bars = [
      { time: unix(2026, 10, 28, 11, 0), close: 1 },
      { time: unix(2026, 10, 30, 10, 0), close: 2 },
      { time: unix(2026, 11, 2, 9, 30), close: 3 },
      { time: unix(2026, 11, 2, 10, 0), close: 4 },
    ]
    const out = barsOnLastTradeDay(bars, "IF2612")
    assert.deepEqual(out.map((bar) => bar.close), [3, 4])
  })

  it("pads 5-minute bars across the same 09:30-15:00 session", () => {
    const bars = [
      { time: unix(2026, 10, 30, 10, 0), close: 1 },
      { time: unix(2026, 11, 2, 9, 30), close: 2 },
      { time: unix(2026, 11, 2, 10, 0), close: 3 },
      { time: unix(2026, 11, 2, 13, 0), close: 4 },
    ]
    const out = padIntradaySeries(bars, "5m", 1, unix(2026, 11, 2, 15, 0))
    assert.equal(out[0]?.time, unix(2026, 11, 2, 9, 30))
    assert.equal(out.at(-1)?.time, unix(2026, 11, 2, 15, 0))
    assert.equal(out.length, 50)
    assert.equal(out.find((point) => point.time === unix(2026, 11, 2, 10, 0))?.close, 3)
    assert.equal(out.find((point) => point.time === unix(2026, 11, 2, 12, 0)), undefined)
    assert.equal(out.find((point) => point.time === unix(2026, 10, 30, 10, 0)), undefined)
  })

  it("stops a 5-minute follow window at the current bucket", () => {
    const out = padIntradaySeries(
      [{ time: unix(2026, 11, 2, 9, 30), close: 2 }],
      "5m",
      1,
      unix(2026, 11, 2, 13, 25),
    )
    assert.equal(out[0]?.time, unix(2026, 11, 2, 9, 30))
    assert.equal(out.at(-1)?.time, unix(2026, 11, 2, 13, 25))
    assert.ok(out.every((point) => point.time <= unix(2026, 11, 2, 13, 25)))
  })
})

describe("chartWindowForSeries", () => {
  it("uses the last 120 daily bars, the same span the fixed window draws", () => {
    const bars = Array.from({ length: 200 }, (_, i) => ({ time: unix(2025, 1, 1) + i * 86400 }))
    const window = chartWindowForSeries(bars, "1d", "fixed-window")
    assert.equal(window?.from, bars[80]?.time)
    assert.equal(window?.to, bars[199]?.time)
    assert.equal(window?.coversAll, false)
  })

  it("follows every bar when the main chart is on auto-scale", () => {
    const bars = [{ time: unix(2023, 1, 3) }, { time: unix(2026, 11, 2) }]
    const window = chartWindowForSeries(bars, "1d", "auto-scale")
    assert.equal(window?.from, bars[0]?.time)
    assert.equal(window?.coversAll, true)
    assert.deepEqual(window?.times, [bars[0]?.time, bars[1]?.time])
  })
})

describe("plotOnVisibleWindow", () => {
  it("keeps a short series on the main chart's dates instead of stretching it", () => {
    const times = [unix(2023, 1, 3), unix(2026, 6, 1), unix(2026, 11, 2)]
    const out = plotOnVisibleWindow(
      [
        { time: unix(2026, 6, 1, 15, 0), close: 2 },
        { time: unix(2026, 11, 2, 15, 0), close: 4 },
      ],
      { from: times[0]!, to: times[2]!, coversAll: true, interval: "1d", times },
      "1d",
    )
    assert.deepEqual(out.map((point) => point.time), times)
    assert.deepEqual(out.map((point) => point.close), [null, 2, 4])
  })

  it("leaves a missing intraday bar as an empty slot", () => {
    const times = [unix(2026, 11, 2, 10, 0), unix(2026, 11, 2, 10, 1)]
    const out = plotOnVisibleWindow(
      [{ time: times[0]!, close: 1 }],
      { from: times[0]!, to: times[1]!, coversAll: false, interval: "1m", times },
      "1m",
    )
    assert.deepEqual(out.map((point) => point.close), [1, null])
  })

  it("lands a minute stamped a second late on that minute", () => {
    const times = [unix(2026, 11, 2, 10, 0), unix(2026, 11, 2, 10, 1)]
    const out = plotOnVisibleWindow(
      [{ time: times[0]! + 1, close: 7 }],
      { from: times[0]!, to: times[1]!, coversAll: false, interval: "1m", times },
      "1m",
    )
    assert.deepEqual(out.map((point) => point.close), [7, null])
  })

  it("keeps the fixed session tail when it runs past the last printed bar", () => {
    const points = [
      { time: unix(2026, 11, 2, 14, 0), close: 3 },
      { time: unix(2026, 11, 2, 15, 0), close: null },
    ]
    const out = plotOnVisibleWindow(
      points,
      {
        from: unix(2026, 11, 2, 9, 30),
        to: unix(2026, 11, 2, 14, 0),
        coversAll: true,
        interval: "1m",
        times: [unix(2026, 11, 2, 14, 0)],
      },
      "1m",
      unix(2026, 11, 2, 15, 0),
    )
    assert.equal(out.length, 2)
    assert.equal(out.at(-1)?.time, unix(2026, 11, 2, 15, 0))
  })
})

describe("sliceSeriesToWindow", () => {
  const daily = [
    { time: unix(2019, 12, 25), close: 1 },
    { time: unix(2026, 6, 1), close: 2 },
    { time: unix(2026, 8, 3), close: 3 },
    { time: unix(2026, 11, 2, 15, 0), close: 4 },
  ]

  it("keeps the daily points inside the main chart window", () => {
    const out = sliceSeriesToWindow(
      daily,
      { from: unix(2026, 6, 1), to: unix(2026, 11, 2), coversAll: false, interval: "1d" },
      "1d",
    )
    assert.deepEqual(out.map((point) => point.close), [2, 3, 4])
  })

  it("ignores a window from a different frequency", () => {
    const out = sliceSeriesToWindow(
      daily,
      { from: unix(2026, 11, 2, 9, 30), to: unix(2026, 11, 2, 15, 0), coversAll: true, interval: "1m" },
      "1d",
    )
    assert.equal(out.length, daily.length)
  })

  it("follows a scrolled intraday slice and can keep the close when the whole session is visible", () => {
    const points = [
      { time: unix(2026, 11, 2, 9, 30), close: 1 },
      { time: unix(2026, 11, 2, 10, 0), close: 2 },
      { time: unix(2026, 11, 2, 14, 0), close: 3 },
    ]
    const scrolled = sliceSeriesToWindow(
      points,
      { from: unix(2026, 11, 2, 10, 0), to: unix(2026, 11, 2, 11, 0), coversAll: false, interval: "1m" },
      "1m",
    )
    assert.deepEqual(scrolled.map((point) => point.close), [2])
    const full = sliceSeriesToWindow(
      points,
      { from: unix(2026, 11, 2, 9, 30), to: unix(2026, 11, 2, 14, 0), coversAll: true, interval: "1m" },
      "1m",
      unix(2026, 11, 2, 15, 0),
    )
    assert.equal(full.length, 3)
  })
})

describe("quote axis end", () => {
  const afternoon = new Date("2026-11-02T05:25:00Z")

  it("follows the current minute", () => {
    assert.equal(quoteAxisEnd("auto-scale", afternoon), unix(2026, 11, 2, 13, 25))
  })

  it("keeps the fixed window through the close", () => {
    assert.equal(quoteAxisEnd("fixed-window", afternoon), unix(2026, 11, 2, 15, 0))
  })
})
