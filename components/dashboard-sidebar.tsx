"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { TrendingUp, LineChart, Rocket, Target, Briefcase, LayoutDashboard, BrainCircuit, Database, CloudSun } from "lucide-react"
import { authService } from "@/lib/auth"
import { canAccessAiKnowledge } from "@/lib/permissions"

const navigation = [
  { name: "总览", href: "/dashboard", icon: LayoutDashboard },
  { name: "宏观市场", href: "/analysis/market", icon: TrendingUp },
  { name: "股票市场", href: "/analysis/stock", icon: LineChart },
  { name: "期货市场", href: "/dashboard/futures-market", icon: Rocket },
  { name: "期权市场", href: "/analysis/options", icon: Target },
  { name: "私募基金", href: "/analysis/fund", icon: Briefcase },
  { name: "AI知识库", href: "/dashboard/ai-knowledge", icon: BrainCircuit, requiresAiKnowledge: true as const },
]

export function DashboardSidebar() {
  const pathname = usePathname()
  const currentUser = authService.getCurrentUser()
  const isCshen = currentUser?.name === "cshen"

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-6 border-b">
        <h2 className="text-lg font-semibold">市场监控</h2>
        <p className="text-sm text-muted-foreground">分析看板</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navigation.filter((item) => !item.requiresAiKnowledge || canAccessAiKnowledge(currentUser)).map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          )
        })}
        {isCshen && (
          <>
            <div className="pt-2 pb-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">管理</p>
            </div>
            <Link
              href="/dashboard/db-explorer"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === "/dashboard/db-explorer"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Database className="h-4 w-4" />
              DB 浏览器
            </Link>
            <Link
              href="/ma/dashboard/all-weather"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === "/ma/dashboard/all-weather"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <CloudSun className="h-4 w-4" />
              全天候跟踪
            </Link>
          </>
        )}
      </nav>
    </aside>
  )
}
