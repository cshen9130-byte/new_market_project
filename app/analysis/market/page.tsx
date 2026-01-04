"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, TrendingUp, Activity } from "lucide-react"
import dynamic from "next/dynamic"

const MarketConditionChart = dynamic(() => import("@/components/charts/market-condition-chart"), { ssr: false })
const MarketHeatmap = dynamic(() => import("@/components/charts/market-heatmap"), { ssr: false })

export default function MarketConditionPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ name: string } | null>(null)

  useEffect(() => {
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      router.push("/login")
    } else {
      setUser(currentUser)
    }
  }, [router])

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-cyan-400 text-xl animate-pulse">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button
            onClick={() => router.push("/dashboard")}
            variant="outline"
            className="border-cyan-500/30 bg-black/80 text-cyan-400 hover:bg-cyan-500/20"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回控制台
          </Button>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">全市场状况</h1>
          <div className="w-32"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <Card className="bg-black/40 border-emerald-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-emerald-400">市场情绪</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-400">看涨</div>
              <p className="text-xs text-emerald-300/60 mt-1">72% 指标为正</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-cyan-400">市场波动率</CardTitle>
              <Activity className="h-4 w-4 text-cyan-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-400">中等</div>
              <p className="text-xs text-cyan-300/60 mt-1">VIX 指数 18.5</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-purple-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-purple-400">全球市场</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-400">上行</div>
              <p className="text-xs text-purple-300/60 mt-1">85% 市场上涨</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-yellow-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-yellow-400">风险等级</CardTitle>
              <Activity className="h-4 w-4 text-yellow-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-400">中等</div>
              <p className="text-xs text-yellow-300/60 mt-1">风险敞口均衡</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-cyan-400">市场指数表现</CardTitle>
            <CardDescription className="text-cyan-300/60">全球指数追踪（可接入API获取实时数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <MarketConditionChart />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">主要指数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "S&P 500", value: "4,567.89", change: "+1.2%", changeValue: "+54.32", trend: "up" },
                  { name: "Dow Jones", value: "35,432.10", change: "+0.8%", changeValue: "+283.45", trend: "up" },
                  { name: "NASDAQ", value: "14,234.56", change: "+1.5%", changeValue: "+213.45", trend: "up" },
                  { name: "Russell 2000", value: "1,987.45", change: "-0.3%", changeValue: "-5.67", trend: "down" },
                ].map((index) => (
                  <div
                    key={index.name}
                    className={`flex items-center justify-between p-3 rounded ${
                      index.trend === "up" ? "bg-emerald-500/10" : "bg-red-500/10"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-cyan-400">{index.name}</div>
                      <div className="text-2xl font-bold text-cyan-300">{index.value}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-lg font-bold ${index.trend === "up" ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {index.change}
                      </div>
                      <div className={`text-xs ${index.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                        {index.changeValue}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">全球市场</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "FTSE 100 (UK)", value: "7,623.45", change: "+0.6%", trend: "up" },
                  { name: "DAX (Germany)", value: "15,987.32", change: "+1.1%", trend: "up" },
                  { name: "Nikkei 225 (Japan)", value: "32,456.78", change: "+0.9%", trend: "up" },
                  { name: "Shanghai (China)", value: "3,234.56", change: "-0.4%", trend: "down" },
                ].map((index) => (
                  <div
                    key={index.name}
                    className={`flex items-center justify-between p-3 rounded ${
                      index.trend === "up" ? "bg-emerald-500/10" : "bg-red-500/10"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-cyan-400">{index.name}</div>
                      <div className="text-xl font-bold text-cyan-300">{index.value}</div>
                    </div>
                    <div className={`text-lg font-bold ${index.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                      {index.change}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-cyan-400">行业表现热力图</CardTitle>
            <CardDescription className="text-cyan-300/60">行业实时表现可视化</CardDescription>
          </CardHeader>
          <CardContent>
            <MarketHeatmap />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
