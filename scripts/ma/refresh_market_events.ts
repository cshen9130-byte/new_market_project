import { addIsoDays } from "@/lib/ma/market-event-calendar-shared"
import { refreshLiveMarketEventCache } from "@/lib/server/market-events-live"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

async function main() {
  const today = shanghaiTodayIsoDate()
  const cache = await refreshLiveMarketEventCache({
    from: addIsoDays(today, -90),
    to: addIsoDays(today, 90),
  })
  process.stdout.write(
    JSON.stringify({
      ok: true,
      count: cache.rows.length,
      shanghaiDate: cache.shanghaiDate,
      from: cache.from,
      to: cache.to,
    }),
  )
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.message : error))
  process.exit(1)
})
