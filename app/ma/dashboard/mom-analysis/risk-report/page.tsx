"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { BarChart2, ShieldAlert, PieChart, Users } from "lucide-react"

const ProductNavChart = dynamic(() => import("@/components/ma/product-nav-chart"), { ssr: false })

const subNavItems = [
  { key: "overview",  name: "产品总览", icon: BarChart2 },
  { key: "intraday",  name: "日间风控", icon: ShieldAlert },
  { key: "position",  name: "持仓分析", icon: PieChart },
  { key: "advisor",   name: "投顾分析", icon: Users },
] as const

type TabKey = (typeof subNavItems)[number]["key"]

function PlaceholderContent({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm">页面建设中，敬请期待。</p>
    </div>
  )
}

function OverviewContent() {
  return (
    <div className="space-y-4">
      <div className="w-full">
        <ProductNavChart height={380} />
      </div>
    </div>
  )
}

export default function RiskReportNewPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview")
  const activeItem = subNavItems.find((i) => i.key === activeTab)!

  return (
    <div className="flex -mx-6 -mb-6" style={{ height: "calc(100% + 1.5rem)" }}>
      {/* Secondary sidebar */}
      <aside className="w-44 shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">MOM 风控报告</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">新版</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {subNavItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  activeTab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === "overview" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-product")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              产品要素 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-performance")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              业绩指标 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-volatility")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              波动分析 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-pnl")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              分类盈亏 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              ↑ 回到顶部
            </button>
          </div>
        )}
        <h1 id="section-top" className="text-2xl font-semibold tracking-tight pt-6 mb-4">{activeItem.name}</h1>
        {activeTab === "overview" ? (
          <OverviewContent />
        ) : (
          <PlaceholderContent title={activeItem.name} />
        )}
      </div>
    </div>
  )
}
