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
      <div className="w-1/2">
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
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-4">{activeItem.name}</h1>
        {activeTab === "overview" ? (
          <OverviewContent />
        ) : (
          <PlaceholderContent title={activeItem.name} />
        )}
      </div>
    </div>
  )
}
