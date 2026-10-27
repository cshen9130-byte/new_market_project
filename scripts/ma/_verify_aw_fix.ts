import assert from "node:assert/strict"
import { allWeatherPositionDailyPnl } from "@/lib/client/all-weather-nav"
import { isCffexContractExpired, listedCffexIndexContracts } from "@/lib/client/cffex-expiry"
import { fetchLiveFuturesPrices } from "@/lib/server/all-weather-prices"
import { getOverview, readPaperBook, refreshPaperBook } from "@/lib/server/all-weather-book"
import { loadLiveStrategySnapshot } from "@/lib/all-weather/live-universe"

async function main() {
  // --- nav lock ---
  const row = {
    symbol: "IF2611",
    lots: 1,
    multiplier: 300,
    prevPrice: 4000,
    price: 4050,
    bookDaily: 15000,
    dailyPnl: 15000,
  }
  const flatMark = () => row.prevPrice
  const afterClose = allWeatherPositionDailyPnl(row, flatMark, new Date("2026-10-27T16:00:00+08:00"))
  assert.equal(afterClose, 15000, "after close should lock book daily")
  const liveMark = () => 4060
  const during = allWeatherPositionDailyPnl(row, liveMark, new Date("2026-10-27T10:00:00+08:00"))
  assert.equal(during, (4060 - 4000) * 300, "during session uses live mark")
  console.log("nav lock ok")

  assert.equal(isCffexContractExpired("IF2609", new Date("2026-10-27T12:00:00+08:00")), true)
  assert.equal(isCffexContractExpired("IF2611", new Date("2026-10-27T12:00:00+08:00")), false)
  assert.equal(isCffexContractExpired("T2609", new Date("2026-10-27T12:00:00+08:00")), true)
  console.log("expiry helpers ok", listedCffexIndexContracts("IF"))

  const before = readPaperBook("vol9-20m")
  console.log("before", {
    asOf: before?.asOf,
    contracts: before?.positions.filter((p) => p.lots > 0).slice(0, 6).map((p) => p.contract),
    dailyPnl: before?.dailyPnl,
  })

  const overview = await refreshPaperBook({ variantId: "vol9-20m" })
  const after = overview.book
  console.log("after refresh", {
    asOf: after.asOf,
    source: after.priceSource,
    dailyPnl: after.dailyPnl,
    equity: after.equity,
    contracts: after.positions.filter((p) => p.lots > 0).slice(0, 8).map((p) => `${p.asset}:${p.contract}:d=${Math.round(p.dailyPnl)}`),
    lastDaily: after.daily.slice(-3).map((d) => ({ date: d.date, pnl: Math.round(d.dailyPnl), equity: Math.round(d.equity) })),
  })

  const expiredHeld = after.positions.filter((p) => p.lots > 0 && isCffexContractExpired(p.contract))
  assert.equal(expiredHeld.length, 0, "no expired CFFEX contracts after refresh: " + expiredHeld.map((p) => p.contract).join(","))
  console.log("refresh rolled expired contracts ok")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
