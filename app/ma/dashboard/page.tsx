import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, BarChart3, Activity, PieChart } from "lucide-react"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">市场总览</h1>
        <p className="text-muted-foreground mt-2">欢迎使用市场监控看板</p>
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
          <CardDescription>从侧边栏选择一个市场板块以查看详细分析</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">宏观市场</h3>
              <p className="text-sm text-muted-foreground">查看经济指标、利率与全球市场趋势</p>
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">股票市场</h3>
              <p className="text-sm text-muted-foreground">监控股票表现、指数与行业分析</p>
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">期货市场</h3>
              <p className="text-sm text-muted-foreground">跟踪大宗商品期货、合约与结算数据</p>
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">期权市场</h3>
              <p className="text-sm text-muted-foreground">分析期权链、波动率与希腊值</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
