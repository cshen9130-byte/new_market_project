"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Line, LineChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Area, AreaChart } from "recharts"
import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"

// Placeholder data - replace with real API data
const commodityPrices = [
  { date: "1月", gold: 1800, silver: 23, oil: 75 },
  { date: "2月", gold: 1820, silver: 24, oil: 78 },
  { date: "3月", gold: 1850, silver: 25, oil: 80 },
  { date: "4月", gold: 1880, silver: 26, oil: 82 },
  { date: "5月", gold: 1900, silver: 27, oil: 79 },
  { date: "6月", gold: 1920, silver: 28, oil: 81 },
]

const contractVolume = [
  { contract: "原油", volume: 450000, oi: 380000 },
  { contract: "天然气", volume: 320000, oi: 290000 },
  { contract: "黄金", volume: 280000, oi: 250000 },
  { contract: "玉米", volume: 190000, oi: 170000 },
  { contract: "标普500", volume: 520000, oi: 480000 },
]

const futuresCurve = [
  { month: "近月", price: 80.5 },
  { month: "次月", price: 81.2 },
  { month: "第三月", price: 81.8 },
  { month: "第四月", price: 82.3 },
  { month: "第五月", price: 82.7 },
  { month: "第六月", price: 83.0 },
]

export default function FuturesMarketPage() {
  const [nhci, setNhci] = useState<Array<{ date: string; close: number }>>([])
  const [loadingNhci, setLoadingNhci] = useState(true)
  const [errorNhci, setErrorNhci] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/nanhua")
        const json = await res.json()
        if (json?.error) {
          setErrorNhci("数据不可用")
        } else if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          setNhci(json.data)
        } else {
          setErrorNhci("数据不可用")
        }
      } catch (e) {
        setErrorNhci("数据不可用")
      } finally {
        setLoadingNhci(false)
      }
    }
    run()
  }, [])
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">期货市场分析</h1>
        <p className="text-muted-foreground mt-2">大宗商品期货与合约分析</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>南华商品指数</CardTitle>
          <CardDescription>去年每日收盘价</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingNhci ? (
            <div className="text-sm text-muted-foreground">正在加载…</div>
          ) : errorNhci ? (
            <div className="text-sm text-destructive">{errorNhci}</div>
          ) : (
            (() => {
              const option = {
                tooltip: { trigger: "axis" },
                xAxis: { type: "category", data: nhci.map((d) => d.date) },
                yAxis: { type: "value" },
                series: [
                  {
                    type: "line",
                    name: "南华商品指数",
                    data: nhci.map((d) => d.close),
                    smooth: true,
                    lineStyle: { width: 2 },
                    symbolSize: 4,
                  },
                ],
              }
              return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
            })()
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>大宗商品价格</CardTitle>
          <CardDescription>黄金（美元/盎司）、白银（美元/盎司）、原油（美元/桶）</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              gold: {
                label: "黄金",
                color: "hsl(var(--chart-1))",
              },
              silver: {
                label: "白银",
                color: "hsl(var(--chart-2))",
              },
              oil: {
                label: "原油",
                color: "hsl(var(--chart-3))",
              },
            }}
            className="h-[350px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={commodityPrices}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="gold" stroke="var(--color-gold)" strokeWidth={2} />
                <Line type="monotone" dataKey="silver" stroke="var(--color-silver)" strokeWidth={2} />
                <Line type="monotone" dataKey="oil" stroke="var(--color-oil)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>期货曲线</CardTitle>
            <CardDescription>原油期货期限结构</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                price: {
                  label: "价格（美元/桶）",
                  color: "hsl(var(--chart-4))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={futuresCurve}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="var(--color-price)"
                    fill="var(--color-price)"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>合约统计</CardTitle>
            <CardDescription>成交量与持仓量最高的合约</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {contractVolume.map((contract, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{contract.contract}</span>
                    <span className="text-muted-foreground">{contract.volume.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(contract.volume / 520000) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
