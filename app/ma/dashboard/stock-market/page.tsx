"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const AshareCrowdingChart = dynamic(
  () => import("@/components/charts/ashare-crowding-chart"),
  { ssr: false },
)

const NationalTeamSection = dynamic(
  () => import("@/components/charts/national-team-section"),
  { ssr: false },
)

const TAB_KEY = "ma-stock-market-tab"
type StockMarketTab = "sentiment" | "national-team"

const SUBTITLE: Record<StockMarketTab, string> = {
  "sentiment": "A股市场情绪、成交额集中度与热点板块",
  "national-team": "泛国家队观察池净申赎、规模与宽基指数对照",
}

export default function StockMarketPage() {
  const [tab, setTab] = useState<StockMarketTab>("sentiment")

  useEffect(() => {
    try {
      const query = new URLSearchParams(window.location.search).get("tab")
      const saved = localStorage.getItem(TAB_KEY)
      const raw = query || saved
      if (raw === "national-team" || raw === "sentiment") setTab(raw)
    } catch { /* ignore */ }
  }, [])

  function onTabChange(value: string) {
    const next = value === "national-team" ? "national-team" : "sentiment"
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
      const url = new URL(window.location.href)
      if (next === "sentiment") url.searchParams.delete("tab")
      else url.searchParams.set("tab", next)
      window.history.replaceState({}, "", url.toString())
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">股票市场分析</h1>
        <p className="text-muted-foreground mt-2">{SUBTITLE[tab]}</p>
      </div>

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="sentiment">市场情绪</TabsTrigger>
          <TabsTrigger value="national-team">国家队</TabsTrigger>
        </TabsList>

        <TabsContent value="sentiment" className="space-y-6">
          <AshareCrowdingChart />
        </TabsContent>

        <TabsContent value="national-team" className="space-y-6">
          <NationalTeamSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
