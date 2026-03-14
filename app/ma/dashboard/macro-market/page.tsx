"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import MarketPredictionSection from "./market-prediction-section"

export default function Page() {
  return (
    <div className="flex flex-col">
      {/* sticky quick-nav bar */}
      <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
        <span className="text-xs text-muted-foreground">快捷导航：</span>
        <button
          onClick={() => document.getElementById("pca-section")?.scrollIntoView({ behavior: "smooth" })}
          className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          PCA 聚类模型 ↓
        </button>
        <button
          onClick={() => document.getElementById("regime-section")?.scrollIntoView({ behavior: "smooth" })}
          className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          经济体制相似性 ↓
        </button>
        <button
          onClick={() => document.getElementById("page-top")?.scrollIntoView({ behavior: "smooth" })}
          className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          ↑ 回到顶部
        </button>
      </div>

      <div id="page-top" className="mt-6">
        <h1 className="text-3xl font-semibold tracking-tight">宏观市场分析</h1>
        <p className="text-muted-foreground mt-2">经济指标与全球市场趋势</p>
      </div>

      <Tabs defaultValue="domestic" className="mt-6 w-full">
        <TabsList className="mb-2">
          <TabsTrigger value="domestic">国内</TabsTrigger>
          <TabsTrigger value="global">全球</TabsTrigger>
        </TabsList>

        <TabsContent value="domestic" className="space-y-6 mt-0">
          <MarketPredictionSection />
        </TabsContent>

        <TabsContent value="global" className="mt-0">
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            全球市场数据（开发中）
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
