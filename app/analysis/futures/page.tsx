"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import dynamic from "next/dynamic"

const FuturesChart = dynamic(() => import("@/components/charts/futures-chart"), { ssr: false })

export default function FuturesAnalysisPage() {
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
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">期货市场分析</h1>
          <div className="w-32"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">未平仓合约</CardTitle>
              <CardDescription className="text-cyan-300/60">合约总数</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-400">2.4M</div>
              <p className="text-xs text-emerald-400 mt-1">较上周 +1.8%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">合约成交量</CardTitle>
              <CardDescription className="text-cyan-300/60">24小时交易</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-400">845K</div>
              <p className="text-xs text-cyan-400 mt-1">较昨日 +3.2%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">活跃合约数</CardTitle>
              <CardDescription className="text-cyan-300/60">当前交易中</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-400">1,523</div>
              <p className="text-xs text-purple-400 mt-1">Across all commodities</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-cyan-400">期货合约价格</CardTitle>
            <CardDescription className="text-cyan-300/60">期货实时数据可视化（可接入API获取实时数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <FuturesChart />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">表现最佳的合约</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { symbol: "GC", name: "Gold Futures", change: "+5.4%", price: "$2,145" },
                  { symbol: "CL", name: "Crude Oil", change: "+4.1%", price: "$78.50" },
                  { symbol: "SI", name: "Silver Futures", change: "+3.8%", price: "$24.30" },
                  { symbol: "NG", name: "Natural Gas", change: "+2.9%", price: "$2.85" },
                ].map((contract) => (
                  <div
                    key={contract.symbol}
                    className="flex items-center justify-between p-2 rounded bg-emerald-500/10"
                  >
                    <div>
                      <div className="font-semibold text-emerald-400">{contract.symbol}</div>
                      <div className="text-xs text-cyan-300/60">{contract.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-400 font-bold">{contract.change}</div>
                      <div className="text-xs text-cyan-300/60">{contract.price}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">市场情绪</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { category: "能源", sentiment: "看涨", percentage: 72 },
                  { category: "金属", sentiment: "看涨", percentage: 68 },
                  { category: "农业", sentiment: "中性", percentage: 52 },
                  { category: "外汇", sentiment: "看跌", percentage: 38 },
                ].map((item) => (
                  <div key={item.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-cyan-400 text-sm">{item.category}</span>
                      <span
                        className={`text-xs font-semibold ${
                          item.sentiment === "看涨"
                            ? "text-emerald-400"
                            : item.sentiment === "看跌"
                              ? "text-red-400"
                              : "text-yellow-400"
                        }`}
                      >
                        {item.sentiment}
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          item.sentiment === "看涨"
                            ? "bg-emerald-400"
                            : item.sentiment === "看跌"
                              ? "bg-red-400"
                              : "bg-yellow-400"
                        }`}
                        style={{ width: `${item.percentage}%` }}
                      ></div>
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
