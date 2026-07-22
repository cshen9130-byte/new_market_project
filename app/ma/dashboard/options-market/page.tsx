"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import dynamic from "next/dynamic"

const FinancialOptionsSection = dynamic(
  () => import("./financial-options-section"),
  { ssr: false, loading: () => <div className="py-24 text-center text-muted-foreground">加载金融期权…</div> },
)

export default function OptionsMarketPage() {
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">期权市场分析</h1>
        <p className="text-muted-foreground mt-2">期权链、波动率与希腊值分析</p>
      </div>

      <Tabs defaultValue="financial" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">市场概览</TabsTrigger>
          <TabsTrigger value="financial">金融期权</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewPlaceholder />
        </TabsContent>

        <TabsContent value="financial">
          <FinancialOptionsSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OverviewPlaceholder() {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>波动率指数</CardTitle>
            <CardDescription>VIX 与实现波动率</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
              商品期权波动率数据即将接入
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>买卖权比率</CardTitle>
            <CardDescription>市场情绪指标</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
              商品期权情绪数据即将接入
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>按行权价的期权成交量</CardTitle>
          <CardDescription>看涨与看跌成交量分布</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
            商品期权成交数据即将接入
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>期权希腊值</CardTitle>
          <CardDescription>组合希腊值概览</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[120px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
            商品期权希腊值数据即将接入
          </div>
        </CardContent>
      </Card>
    </>
  )
}
