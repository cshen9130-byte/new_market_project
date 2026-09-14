import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, BarChart3, Activity, PieChart } from "lucide-react"
import { QuickStartShortcuts } from "@/components/ma/quick-start-shortcuts"
import { MarketEventCalendar } from "@/components/ma/market-event-calendar"
import { addIsoDays } from "@/lib/ma/market-event-calendar-shared"
import { getLiveMarketEvents } from "@/lib/server/market-events-live"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

export default async function DashboardPage() {
  const today = shanghaiTodayIsoDate()
  const live = await getLiveMarketEvents({ from: addIsoDays(today, -90), to: addIsoDays(today, 90) })
  const events = live.events

  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">系统总览</h1>
        <p className="text-muted-foreground mt-2">欢迎使用监控看板</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">市场状态</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">活跃</div>
            <p className="text-xs text-muted-foreground">实时监控</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">数据源</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">5</div>
            <p className="text-xs text-muted-foreground">市场板块</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">更新</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">实时</div>
            <p className="text-xs text-muted-foreground">持续推送</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">分析</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">就绪</div>
            <p className="text-xs text-muted-foreground">图表分析</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>快速开始</CardTitle>
          <CardDescription>按当前登录账号，显示最近常用的页面快捷入口</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QuickStartShortcuts />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>事件日历</CardTitle>
          <CardDescription>
            华尔街见闻财经日历实时数据，每个北京自然日自动刷新今值 / 预期 / 前值。
            {live.live ? "" : " 当前为本地备用日程。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarketEventCalendar
            today={today}
            events={events}
            sourceLabel={live.source}
            autoScrollToLive={false}
          />
        </CardContent>
      </Card>
    </div>
  )
}
