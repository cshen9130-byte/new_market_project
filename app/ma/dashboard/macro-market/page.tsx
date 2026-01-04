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
  Area,
  AreaChart,
} from "recharts"

// Placeholder data - replace with real API data
const interestRateData = [
  { month: "1月", rate: 4.5 },
  { month: "2月", rate: 4.6 },
  { month: "3月", rate: 4.7 },
  { month: "4月", rate: 4.8 },
  { month: "5月", rate: 4.9 },
  { month: "6月", rate: 5.0 },
]

const gdpData = [
  { quarter: "一季度", gdp: 2.1 },
  { quarter: "二季度", gdp: 2.3 },
  { quarter: "三季度", gdp: 2.5 },
  { quarter: "四季度", gdp: 2.4 },
]

const inflationData = [
  { month: "1月", cpi: 3.1, ppi: 2.8 },
  { month: "2月", cpi: 3.2, ppi: 2.9 },
  { month: "3月", cpi: 3.4, ppi: 3.1 },
  { month: "4月", cpi: 3.3, ppi: 3.0 },
  { month: "5月", cpi: 3.2, ppi: 2.9 },
  { month: "6月", cpi: 3.1, ppi: 2.8 },
]

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">宏观市场分析</h1>
        <p className="text-muted-foreground mt-2">经济指标与全球市场趋势</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>利率</CardTitle>
            <CardDescription>联邦基金利率趋势</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                rate: {
                  label: "利率 (%)",
                  color: "hsl(var(--chart-1))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={interestRateData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="rate" stroke="var(--color-rate)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GDP 增长</CardTitle>
            <CardDescription>季度 GDP 增长率</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                gdp: {
                  label: "GDP (%)",
                  color: "hsl(var(--chart-2))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gdpData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="quarter" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="gdp" fill="var(--color-gdp)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>通胀指标</CardTitle>
          <CardDescription>CPI 与 PPI 对比</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              cpi: {
                label: "CPI (%)",
                color: "hsl(var(--chart-3))",
              },
              ppi: {
                label: "PPI (%)",
                color: "hsl(var(--chart-4))",
              },
            }}
            className="h-[350px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={inflationData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="cpi"
                  stroke="var(--color-cpi)"
                  fill="var(--color-cpi)"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="ppi"
                  stroke="var(--color-ppi)"
                  fill="var(--color-ppi)"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
