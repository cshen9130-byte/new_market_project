"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Bar,
  BarChart,
  ComposedChart,
} from "recharts"

// Placeholder data - replace with real API data
const volatilityData = [
  { date: "1月", vix: 18.5, realized: 15.2 },
  { date: "2月", vix: 19.2, realized: 16.1 },
  { date: "3月", vix: 22.5, realized: 20.3 },
  { date: "4月", vix: 20.1, realized: 18.5 },
  { date: "5月", vix: 18.8, realized: 16.8 },
  { date: "6月", vix: 17.5, realized: 15.5 },
]

const putCallRatio = [
  { date: "周一", ratio: 0.85 },
  { date: "周二", ratio: 0.92 },
  { date: "周三", ratio: 1.05 },
  { date: "周四", ratio: 0.98 },
  { date: "周五", ratio: 0.88 },
]

const optionVolume = [
  { strike: "460", calls: 12000, puts: 8000 },
  { strike: "470", calls: 18000, puts: 10000 },
  { strike: "480", calls: 25000, puts: 15000 },
  { strike: "490", calls: 20000, puts: 22000 },
  { strike: "500", calls: 15000, puts: 28000 },
]

const greeksData = [
  { metric: "德尔塔 (Delta)", value: 0.65 },
  { metric: "伽马 (Gamma)", value: 0.05 },
  { metric: "西塔 (Theta)", value: -0.15 },
  { metric: "维加 (Vega)", value: 0.25 },
]

export default function OptionsMarketPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">期权市场分析</h1>
        <p className="text-muted-foreground mt-2">期权链、波动率与希腊值分析</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>波动率指数</CardTitle>
            <CardDescription>VIX 与实现波动率</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                vix: {
                  label: "VIX",
                  color: "hsl(var(--chart-1))",
                },
                realized: {
                  label: "实现波动率",
                  color: "hsl(var(--chart-2))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={volatilityData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="vix" stroke="var(--color-vix)" strokeWidth={2} />
                  <Line type="monotone" dataKey="realized" stroke="var(--color-realized)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>买卖权比率</CardTitle>
            <CardDescription>市场情绪指标</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                ratio: {
                  label: "买卖权比",
                  color: "hsl(var(--chart-3))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={putCallRatio}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="ratio" fill="var(--color-ratio)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>按行权价的期权成交量</CardTitle>
          <CardDescription>看涨与看跌成交量分布</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              calls: {
                label: "看涨",
                color: "hsl(var(--chart-4))",
              },
              puts: {
                label: "看跌",
                color: "hsl(var(--chart-5))",
              },
            }}
            className="h-[350px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={optionVolume}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="strike" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="calls" fill="var(--color-calls)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="puts" fill="var(--color-puts)" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>期权希腊值</CardTitle>
          <CardDescription>组合希腊值概览</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {greeksData.map((greek, index) => (
              <div key={index} className="space-y-2 p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">{greek.metric}</div>
                <div className="text-2xl font-bold">{greek.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
