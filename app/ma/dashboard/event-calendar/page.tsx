import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MarketEventCalendar } from "@/components/ma/market-event-calendar"
import { addIsoDays } from "@/lib/ma/market-event-calendar-shared"
import { getLiveMarketEvents } from "@/lib/server/market-events-live"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

export default async function EventCalendarPage() {
  const today = shanghaiTodayIsoDate()
  const live = await getLiveMarketEvents({ from: addIsoDays(today, -90), to: addIsoDays(today, 90) })

  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">事件日历</h1>
        <p className="text-muted-foreground mt-2">
          可能扰动股债汇商的宏观发布、央行决议与休市安排
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>财经日历</CardTitle>
          <CardDescription>
            华尔街见闻财经日历实时数据，每个北京自然日自动刷新今值 / 预期 / 前值。
            {live.live ? "" : " 当前为本地备用日程。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarketEventCalendar today={today} events={live.events} sourceLabel={live.source} />
        </CardContent>
      </Card>
    </div>
  )
}
