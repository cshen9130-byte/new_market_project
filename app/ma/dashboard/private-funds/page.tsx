"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Bar, BarChart, Area, AreaChart } from "recharts"

// Placeholder data - replace with real API data
const fundPerformance = [
  { month: "1月", fundA: 5.2, fundB: 4.8, fundC: 6.1, benchmark: 4.5 },
  { month: "2月", fundA: 5.8, fundB: 5.2, fundC: 6.5, benchmark: 5.0 },
  { month: "3月", fundA: 6.2, fundB: 5.5, fundC: 6.8, benchmark: 5.2 },
  { month: "4月", fundA: 6.5, fundB: 5.9, fundC: 7.2, benchmark: 5.5 },
  { month: "5月", fundA: 7.0, fundB: 6.2, fundC: 7.8, benchmark: 5.8 },
  { month: "6月", fundA: 7.5, fundB: 6.8, fundC: 8.5, benchmark: 6.2 },
]

const fundMetrics = [
  { fund: "基金A", aum: 250, returns: 7.5, sharpe: 1.8 },
  { fund: "基金B", aum: 180, returns: 6.8, sharpe: 1.6 },
  { fund: "基金C", aum: 320, returns: 8.5, sharpe: 2.1 },
  { fund: "基金D", aum: 150, returns: 5.9, sharpe: 1.4 },
]

const allocationData = [
  { asset: "股票", allocation: 45 },
  { asset: "固定收益", allocation: 25 },
  { asset: "另类投资", allocation: 15 },
  { asset: "房地产", allocation: 10 },
  { asset: "现金", allocation: 5 },
]

export default function PrivateFundsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">私募基金业绩</h1>
        <p className="text-muted-foreground mt-2">基金分析与业绩指标</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>累计回报</CardTitle>
          <CardDescription>年初至今相对基准表现（%）</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              fundA: {
                label: "基金A",
                color: "hsl(var(--chart-1))",
              },
              fundB: {
                label: "基金B",
                color: "hsl(var(--chart-2))",
              },
              fundC: {
                label: "基金C",
                color: "hsl(var(--chart-3))",
              },
              benchmark: {
                label: "基准",
                color: "hsl(var(--chart-4))",
              },
            }}
            className="h-[350px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={fundPerformance}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="fundA"
                  stroke="var(--color-fundA)"
                  fill="var(--color-fundA)"
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="fundB"
                  stroke="var(--color-fundB)"
                  fill="var(--color-fundB)"
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="fundC"
                  stroke="var(--color-fundC)"
                  fill="var(--color-fundC)"
                  fillOpacity={0.2}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="var(--color-benchmark)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>管理规模</CardTitle>
            <CardDescription>各基金总管理规模（百万美元）</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                aum: {
                  label: "管理规模（百万美元）",
                  color: "hsl(var(--chart-5))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fundMetrics}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="fund" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="aum" fill="var(--color-aum)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>资产配置</CardTitle>
            <CardDescription>组合构成（%）</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {allocationData.map((asset, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{asset.asset}</span>
                    <span className="text-muted-foreground">{asset.allocation}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${asset.allocation}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基金绩效指标</CardTitle>
          <CardDescription>关键指标概览</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">基金</th>
                  <th className="text-right py-3 px-4 font-medium">管理规模（百万美元）</th>
                  <th className="text-right py-3 px-4 font-medium">年初至今回报（%）</th>
                  <th className="text-right py-3 px-4 font-medium">夏普比率</th>
                </tr>
              </thead>
              <tbody>
                {fundMetrics.map((fund, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-3 px-4 font-medium">{fund.fund}</td>
                    <td className="text-right py-3 px-4">{fund.aum}</td>
                    <td className="text-right py-3 px-4">{fund.returns}%</td>
                    <td className="text-right py-3 px-4">{fund.sharpe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
