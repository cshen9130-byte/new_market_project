"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { TrendingUp, LineChart, Rocket, Target, Briefcase, LayoutDashboard, BrainCircuit, Home, Wrench, BarChart2 } from "lucide-react"
import type React from "react"

const navigation = [
  { name: "总览", href: "/ma/dashboard", icon: LayoutDashboard },
  { name: "宏观市场", href: "/ma/dashboard/macro-market", icon: TrendingUp },
  { name: "股票市场", href: "/ma/dashboard/stock-market", icon: LineChart },
  { name: "期货市场", href: "/ma/dashboard/futures-market", icon: Rocket },
  { name: "期权市场", href: "/ma/dashboard/options-market", icon: Target },
  { name: "私募基金", href: "/ma/dashboard/private-funds", icon: Briefcase },
  { name: "MOM分析", href: "/ma/dashboard/mom-analysis", icon: BarChart2 },
  { name: "小工具", href: "/ma/dashboard/tools", icon: Wrench },
  { name: "__home__", href: "/ma/dashboard", icon: Home },
  { name: "AI知识库", href: "/ma/dashboard/ai-knowledge", icon: BrainCircuit },
]

export function DashboardSidebar() {
  const pathname = usePathname()
  const isCollapsed = pathname === "/ma/dashboard/ai-knowledge"

  return (
    <aside className={cn("border-r bg-card flex flex-col transition-all duration-200", isCollapsed ? "w-20" : "w-64")}>
      <div className={cn("border-b", isCollapsed ? "px-3 py-6" : "p-6")}>
        {isCollapsed ? (
          <Link href="/ma/dashboard" title="返回主页" className="flex flex-col items-center gap-1 hover:text-primary transition-colors">
            <Home className="h-5 w-5" />
            <div className="text-xs font-semibold">主页</div>
          </Link>
        ) : (
          <>
            <h2 className="text-lg font-semibold">市场监控</h2>
            <p className="text-sm text-muted-foreground">分析看板（传统风格）</p>
          </>
        )}
      </div>
      <nav className={cn("flex-1 space-y-1", isCollapsed ? "p-2" : "p-4")}>
        {navigation.map((item) => {
          const isActive = pathname === item.href
          const baseClasses = cn(
            "rounded-lg text-sm font-medium transition-colors",
            isCollapsed ? "flex justify-center px-2 py-3" : "px-3 py-2",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )

          if (item.name === "__home__") {
            if (!isCollapsed) return null
            return (
              <Link
                key="__home__"
                href={item.href}
                title="返回主页"
                className={cn(baseClasses, "flex flex-col items-center gap-0.5 border border-dashed border-border/60 py-2")}
              >
                <item.icon className="h-4 w-4" />
                <span className="text-[10px] leading-none">返回</span>
              </Link>
            )
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              title={isCollapsed ? item.name : undefined}
              className={cn(baseClasses, "flex items-center gap-3")}
            >
              <item.icon className="h-4 w-4" />
              {!isCollapsed && item.name}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
