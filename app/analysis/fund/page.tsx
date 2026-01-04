"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, TrendingUp, DollarSign, PieChart, BarChart3 } from "lucide-react"
import dynamic from "next/dynamic"

const FundPerformanceChart = dynamic(() => import("@/components/charts/fund-performance-chart"), { ssr: false })
const FundAllocationChart = dynamic(() => import("@/components/charts/fund-allocation-chart"), { ssr: false })

export default function FundPerformancePage() {
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
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">基金表现分析</h1>
          <div className="w-32"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <Card className="bg-black/40 border-emerald-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-emerald-400">资产管理规模（AUM）</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-400">$8.4B</div>
              <p className="text-xs text-emerald-300/60 mt-1">同比增长 +12.5%</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-cyan-400">平均回报率</CardTitle>
              <TrendingUp className="h-4 w-4 text-cyan-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-400">18.7%</div>
              <p className="text-xs text-cyan-300/60 mt-1">年化回报率</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-purple-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-purple-400">夏普比率</CardTitle>
              <BarChart3 className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-400">1.82</div>
              <p className="text-xs text-purple-300/60 mt-1">风险调整后回报</p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-yellow-500/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-yellow-400">活跃基金数</CardTitle>
              <PieChart className="h-4 w-4 text-yellow-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-400">247</div>
              <p className="text-xs text-yellow-300/60 mt-1">覆盖所有类别</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-cyan-400">基金表现对比</CardTitle>
            <CardDescription className="text-cyan-300/60">历史表现追踪（可接入API获取实时数据）</CardDescription>
          </CardHeader>
          <CardContent>
            <FundPerformanceChart />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">表现最佳基金</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "科技成长基金", return: "+42.3%", aum: "$1.2B", rating: "5星" },
                  { name: "AI创新基金", return: "+38.7%", aum: "$890M", rating: "5星" },
                  { name: "医疗领袖", return: "+32.1%", aum: "$1.5B", rating: "4星" },
                  { name: "新兴市场", return: "+28.4%", aum: "$720M", rating: "4星" },
                ].map((fund) => (
                  <div key={fund.name} className="flex items-center justify-between p-3 rounded bg-emerald-500/10">
                    <div className="flex-1">
                      <div className="font-semibold text-emerald-400">{fund.name}</div>
                      <div className="text-xs text-cyan-300/60">AUM: {fund.aum}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-400">{fund.return}</div>
                      <div className="text-xs text-yellow-400">{fund.rating}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-400">资产配置</CardTitle>
            </CardHeader>
            <CardContent>
              <FundAllocationChart />
            </CardContent>
          </Card>
        </div>

        <Card className="bg-black/40 border-cyan-500/30 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-cyan-400">基金类别表现</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { category: "股票型基金", count: 87, avgReturn: "+24.3%", color: "emerald" },
                { category: "债券型基金", count: 52, avgReturn: "+8.7%", color: "cyan" },
                { category: "平衡型基金", count: 43, avgReturn: "+15.2%", color: "purple" },
                { category: "指数型基金", count: 31, avgReturn: "+18.9%", color: "blue" },
                { category: "国际型基金", count: 24, avgReturn: "+21.4%", color: "yellow" },
                { category: "行业基金", count: 10, avgReturn: "+28.6%", color: "pink" },
              ].map((cat) => (
                <div key={cat.category} className="p-4 rounded bg-black/40 border border-cyan-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-${cat.color}-400 font-semibold`}>{cat.category}</div>
                    <div className="text-cyan-300/60 text-sm">{cat.count} 只基金</div>
                  </div>
                  <div className={`text-2xl font-bold text-${cat.color}-400`}>{cat.avgReturn}</div>
                  <div className="text-xs text-cyan-300/60 mt-1">平均年化回报</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
