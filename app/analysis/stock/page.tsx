"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import dynamic from "next/dynamic"

const StockChart = dynamic(() => import("@/components/charts/stock-chart"), { ssr: false })

export default function StockAnalysisPage() {
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
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">股票市场分析</h1>
          <div className="w-32"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">总市值</CardTitle>
              <CardDescription className="text-cyan-300/60">总规模</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-400">$45.2T</div>
              <p className="text-xs text-emerald-400 mt-1">较上月 +2.4%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">交易量</CardTitle>
              <CardDescription className="text-cyan-300/60">24小时成交</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-400">$892B</div>
              <p className="text-xs text-cyan-400 mt-1">较昨日 +5.1%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">活跃股票数</CardTitle>
              <CardDescription className="text-cyan-300/60">当前交易中</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-400">8,247</div>
              <p className="text-xs text-purple-400 mt-1">Across all exchanges</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-cyan-400">股价走势</CardTitle>
            <CardDescription className="text-cyan-300/60">实时市场可视化（可接入API获取实时数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <StockChart />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">涨幅榜</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { symbol: "NVDA", name: "NVIDIA Corp", change: "+8.2%" },
                  { symbol: "TSLA", name: "Tesla Inc", change: "+6.7%" },
                  { symbol: "AAPL", name: "Apple Inc", change: "+4.3%" },
                  { symbol: "MSFT", name: "Microsoft Corp", change: "+3.9%" },
                ].map((stock) => (
                  <div key={stock.symbol} className="flex items-center justify-between p-2 rounded bg-emerald-500/10">
                    <div>
                      <div className="font-semibold text-emerald-400">{stock.symbol}</div>
                      <div className="text-xs text-cyan-300/60">{stock.name}</div>
                    </div>
                    <div className="text-emerald-400 font-bold">{stock.change}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">跌幅榜</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { symbol: "META", name: "Meta Platforms", change: "-3.2%" },
                  { symbol: "AMZN", name: "Amazon.com Inc", change: "-2.8%" },
                  { symbol: "GOOGL", name: "Alphabet Inc", change: "-2.1%" },
                  { symbol: "NFLX", name: "Netflix Inc", change: "-1.9%" },
                ].map((stock) => (
                  <div key={stock.symbol} className="flex items-center justify-between p-2 rounded bg-red-500/10">
                    <div>
                      <div className="font-semibold text-red-400">{stock.symbol}</div>
                      <div className="text-xs text-cyan-300/60">{stock.name}</div>
                    </div>
                    <div className="text-red-400 font-bold">{stock.change}</div>
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
