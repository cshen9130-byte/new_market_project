"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import MarketPredictionSection from "./market-prediction-section"
import GlobalFomcSection from "./global-fomc-section"

const DOMESTIC_NAV = [
  { id: "pca-section", label: "PCA 聚类模型 ↓" },
  { id: "regime-section", label: "经济体制相似性 ↓" },
  { id: "money-credit-section", label: "货币+信用 ↓" },
]

const GLOBAL_NAV = [
  { id: "fomc-cpi-section", label: "每日跟踪 ↓" },
  { id: "fedwatch-section", label: "加息概率 ↓" },
  { id: "unrate-section", label: "失业率 ↓" },
  { id: "cpi-yoy-section", label: "通胀同比 ↓" },
  { id: "fomc-meetings-section", label: "会议对照 ↓" },
]

export default function Page() {
  const [tab, setTab] = useState("domestic")
  const [region, setRegion] = useState("us")
  const nav = tab === "global" && region === "us" ? GLOBAL_NAV : tab === "domestic" ? DOMESTIC_NAV : []

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
        <span className="text-xs text-muted-foreground">快捷导航：</span>
        {nav.map((item) => (
          <button
            key={item.id}
            onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })}
            className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {item.label}
          </button>
        ))}
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

      <Tabs value={tab} onValueChange={setTab} className="mt-6 w-full">
        <TabsList className="mb-2">
          <TabsTrigger value="domestic">国内</TabsTrigger>
          <TabsTrigger value="global">全球</TabsTrigger>
        </TabsList>

        <TabsContent value="domestic" className="space-y-6 mt-0">
          <MarketPredictionSection />
        </TabsContent>

        <TabsContent value="global" className="mt-0">
          <Tabs value={region} onValueChange={setRegion} className="w-full">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">地区</span>
              <TabsList>
                <TabsTrigger value="us">美国</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="us" className="mt-0">
              <GlobalFomcSection />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  )
}
