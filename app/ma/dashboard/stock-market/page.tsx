"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Line, LineChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Bar, BarChart } from "recharts"

// Placeholder data - replace with real API data
const indexData = [
  { date: "1月", sp500: 4500, nasdaq: 14000, dow: 35000 },
  { date: "2月", sp500: 4600, nasdaq: 14200, dow: 35500 },
  { date: "3月", sp500: 4550, nasdaq: 14100, dow: 35200 },
  { date: "4月", sp500: 4700, nasdaq: 14500, dow: 36000 },
  { date: "5月", sp500: 4800, nasdaq: 14800, dow: 36500 },
  { date: "6月", sp500: 4850, nasdaq: 15000, dow: 37000 },
]

const sectorPerformance = [
  { sector: "科技", return: 12.5 },
  { sector: "金融", return: 8.3 },
  { sector: "医疗保健", return: 6.7 },
  { sector: "能源", return: 15.2 },
  { sector: "消费", return: 4.9 },
  { sector: "工业", return: 7.1 },
]

const volumeData = [
  { date: "周一", volume: 85 },
  { date: "周二", volume: 92 },
  { date: "周三", volume: 78 },
  { date: "周四", volume: 105 },
  { date: "周五", volume: 88 },
]

export default function StockMarketPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">股票市场分析</h1>
        <p className="text-muted-foreground mt-2">股票表现与行业分析</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Major Indices</CardTitle>
          <CardDescription>S&P 500, NASDAQ, and Dow Jones performance</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              sp500: {
                label: "标普500",
                color: "hsl(var(--chart-1))",
              },
              nasdaq: {
                label: "纳斯达克",
                color: "hsl(var(--chart-2))",
              },
              dow: {
                label: "道琼斯",
                color: "hsl(var(--chart-3))",
              },
            }}
            className="h-[350px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={indexData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="sp500" stroke="var(--color-sp500)" strokeWidth={2} />
                <Line type="monotone" dataKey="nasdaq" stroke="var(--color-nasdaq)" strokeWidth={2} />
                <Line type="monotone" dataKey="dow" stroke="var(--color-dow)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sector Performance</CardTitle>
            <CardDescription>YTD returns by sector (%)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                return: {
                  label: "回报率 (%)",
                  color: "hsl(var(--chart-4))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectorPerformance} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="text-xs" />
                  <YAxis type="category" dataKey="sector" className="text-xs" width={80} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="return" fill="var(--color-return)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trading Volume</CardTitle>
            <CardDescription>Daily trading volume (billions)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                volume: {
                  label: "成交量（十亿）",
                  color: "hsl(var(--chart-5))",
                },
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="volume" fill="var(--color-volume)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
