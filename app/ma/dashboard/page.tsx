import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, BarChart3, Activity, PieChart } from "lucide-react"

const momReportUrl = (process.env.NEXT_PUBLIC_MOM_REPORT_URL || "/mom_report/report.html?v=debug") as string

export default function DashboardPage() {
  return (
    <div className="space-y-6 pt-6">
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
            <Link href="/ma/dashboard/macro-market" className="border rounded-lg p-4 transition-colors bg-blue-50/60 border-blue-200 hover:bg-blue-100/80 dark:bg-blue-950/30 dark:border-blue-800 dark:hover:bg-blue-900/40">
              <h3 className="font-semibold mb-2 text-blue-700 dark:text-blue-300">宏观市场</h3>
              <p className="text-sm text-muted-foreground">查看经济指标、利率与全球市场趋势</p>
            </Link>
            <Link href="/ma/dashboard/stock-market" className="border rounded-lg p-4 transition-colors bg-emerald-50/60 border-emerald-200 hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:border-emerald-800 dark:hover:bg-emerald-900/40">
              <h3 className="font-semibold mb-2 text-emerald-700 dark:text-emerald-300">股票市场</h3>
              <p className="text-sm text-muted-foreground">监控股票表现、指数与行业分析</p>
            </Link>
            <Link href="/ma/dashboard/futures-market" className="border rounded-lg p-4 transition-colors bg-orange-50/60 border-orange-200 hover:bg-orange-100/80 dark:bg-orange-950/30 dark:border-orange-800 dark:hover:bg-orange-900/40">
              <h3 className="font-semibold mb-2 text-orange-700 dark:text-orange-300">期货市场</h3>
              <p className="text-sm text-muted-foreground">跟踪大宗商品期货、合约与结算数据</p>
            </Link>
            <Link href="/ma/dashboard/options-market" className="border rounded-lg p-4 transition-colors bg-violet-50/60 border-violet-200 hover:bg-violet-100/80 dark:bg-violet-950/30 dark:border-violet-800 dark:hover:bg-violet-900/40">
              <h3 className="font-semibold mb-2 text-violet-700 dark:text-violet-300">期权市场</h3>
              <p className="text-sm text-muted-foreground">分析期权链、波动率与希腊值</p>
            </Link>
            <Link href="/ma/dashboard/private-funds" className="border rounded-lg p-4 transition-colors bg-rose-50/60 border-rose-200 hover:bg-rose-100/80 dark:bg-rose-950/30 dark:border-rose-800 dark:hover:bg-rose-900/40">
              <h3 className="font-semibold mb-2 text-rose-700 dark:text-rose-300">私募基金</h3>
              <p className="text-sm text-muted-foreground">私募基金净值与绩效跟踪</p>
            </Link>
            <Link href="/ma/dashboard/mom-analysis" className="border rounded-lg p-4 transition-colors bg-cyan-50/60 border-cyan-200 hover:bg-cyan-100/80 dark:bg-cyan-950/30 dark:border-cyan-800 dark:hover:bg-cyan-900/40">
              <h3 className="font-semibold mb-2 text-cyan-700 dark:text-cyan-300">MOM分析</h3>
              <p className="text-sm text-muted-foreground">月度绩效分析与归因，含风控报告与数据导入</p>
            </Link>
            <Link href="/ma/dashboard/tools" className="border rounded-lg p-4 transition-colors bg-amber-50/60 border-amber-200 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:border-amber-800 dark:hover:bg-amber-900/40">
              <h3 className="font-semibold mb-2 text-amber-700 dark:text-amber-300">小工具</h3>
              <p className="text-sm text-muted-foreground">净值表识别清洗等数据处理辅助工具</p>
            </Link>
            <Link href="/ma/dashboard/ai-knowledge" className="border rounded-lg p-4 transition-colors bg-indigo-50/60 border-indigo-200 hover:bg-indigo-100/80 dark:bg-indigo-950/30 dark:border-indigo-800 dark:hover:bg-indigo-900/40">
              <h3 className="font-semibold mb-2 text-indigo-700 dark:text-indigo-300">AI知识库</h3>
              <p className="text-sm text-muted-foreground">知识检索与智能问答</p>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
