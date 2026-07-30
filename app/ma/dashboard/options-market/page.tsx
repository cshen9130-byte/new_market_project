"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import dynamic from "next/dynamic"
import { ChartCardHeader } from "./chart-help"

const FinancialOptionsSection = dynamic(
  () => import("./financial-options-section"),
  { ssr: false, loading: () => <div className="py-24 text-center text-muted-foreground">加载金融期权…</div> },
)

const CommodityOptionsSection = dynamic(
  () => import("./commodity-options-section"),
  { ssr: false, loading: () => <div className="py-24 text-center text-muted-foreground">加载商品期权…</div> },
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
          <TabsTrigger value="commodity">商品期权</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewPlaceholder />
        </TabsContent>

        <TabsContent value="financial">
          <FinancialOptionsSection />
        </TabsContent>

        <TabsContent value="commodity">
          <CommodityOptionsSection />
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
          <ChartCardHeader
            chartId="overview-vix"
            title="波动率指数"
            description="金融与商品期权波动率总览"
          />
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
              跨市场波动率对比即将接入 · 可先查看「金融期权」「商品期权」分项
            </div>
          </CardContent>
        </Card>
        <Card>
          <ChartCardHeader
            chartId="overview-pcr"
            title="买卖权比率"
            description="市场情绪指标"
          />
          <CardContent>
            <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
              情绪指标数据即将接入
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <ChartCardHeader
          chartId="overview-volume"
          title="按行权价的期权成交量"
          description="看涨与看跌成交量分布"
        />
        <CardContent>
          <div className="h-[350px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
            成交分布数据即将接入
          </div>
        </CardContent>
      </Card>

      <Card>
        <ChartCardHeader
          chartId="overview-greeks"
          title="期权希腊值"
          description="组合希腊值概览"
        />
        <CardContent>
          <div className="h-[120px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-lg">
            希腊值汇总数据即将接入
          </div>
        </CardContent>
      </Card>
    </>
  )
}
