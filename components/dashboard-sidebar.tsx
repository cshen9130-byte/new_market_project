"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { TrendingUp, LineChart, Rocket, Target, Briefcase, LayoutDashboard } from "lucide-react"

const navigation = [
  { name: "总览", href: "/dashboard", icon: LayoutDashboard },
  { name: "宏观市场", href: "/analysis/market", icon: TrendingUp },
  { name: "股票市场", href: "/analysis/stock", icon: LineChart },
  { name: "期货市场", href: "/dashboard/futures-market", icon: Rocket },
  { name: "期权市场", href: "/analysis/options", icon: Target },
  { name: "私募基金", href: "/analysis/fund", icon: Briefcase },
]

export function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-6 border-b">
        <h2 className="text-lg font-semibold">市场监控</h2>
        <p className="text-sm text-muted-foreground">分析看板</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
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
      </nav>
    </aside>
  )
}
