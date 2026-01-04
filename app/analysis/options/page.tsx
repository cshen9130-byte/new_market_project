"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import dynamic from "next/dynamic"

const OptionsChart = dynamic(() => import("@/components/charts/options-chart"), { ssr: false })

export default function OptionsAnalysisPage() {
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
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">期权市场分析</h1>
          <div className="w-32"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">总成交量</CardTitle>
              <CardDescription className="text-cyan-300/60">成交合约数</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-400">12.8M</div>
              <p className="text-xs text-emerald-400 mt-1">较上周 +4.2%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">认沽/认购比</CardTitle>
              <CardDescription className="text-cyan-300/60">市场情绪</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-400">0.87</div>
              <p className="text-xs text-cyan-400 mt-1">略偏向看涨</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">隐含波动率</CardTitle>
              <CardDescription className="text-cyan-300/60">VIX 指数</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-400">18.5</div>
              <p className="text-xs text-purple-400 mt-1">Moderate volatility</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-cyan-400">期权成交与未平仓</CardTitle>
            <CardDescription className="text-cyan-300/60">期权实时数据可视化（可接入API获取实时数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <OptionsChart />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">最活跃期权</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { symbol: "SPY", strike: "$450", type: "Call", volume: "892K", iv: "22.5%" },
                  { symbol: "AAPL", strike: "$180", type: "Call", volume: "654K", iv: "28.3%" },
                  { symbol: "TSLA", strike: "$250", type: "Put", volume: "521K", iv: "45.7%" },
                  { symbol: "NVDA", strike: "$500", type: "Call", volume: "487K", iv: "38.2%" },
                ].map((option, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-cyan-500/10">
                    <div>
                      <div className="font-semibold text-cyan-400">
                        {option.symbol} {option.strike}
                      </div>
                      <div className="text-xs text-cyan-300/60">
                        {option.type === "Call" ? "认购" : "认沽"} • 量: {option.volume}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-cyan-400 text-sm">IV: {option.iv}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">期权资金流分析</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { type: "异常认购活跃", count: 47, trend: "up" },
                  { type: "异常认沽活跃", count: 32, trend: "down" },
                  { type: "大宗交易", count: 18, trend: "up" },
                  { type: "扫单交易", count: 25, trend: "up" },
                ].map((flow) => (
                  <div key={flow.type} className="flex items-center justify-between p-2 rounded bg-black/40">
                    <div className="text-cyan-400 text-sm">{flow.type}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-cyan-300 font-bold">{flow.count}</span>
                      <span className={`text-xs ${flow.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                        {flow.trend === "up" ? "↑" : "↓"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
