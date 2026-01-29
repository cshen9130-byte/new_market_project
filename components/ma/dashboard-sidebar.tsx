"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { TrendingUp, LineChart, Rocket, Target, Briefcase, LayoutDashboard, FileText } from "lucide-react"
import type React from "react"
import { Button } from "../ui/button"
import { Download } from "lucide-react"

const momReportUrl = (process.env.NEXT_PUBLIC_MOM_REPORT_URL || "/mom_report/report.html?v=debug") as string
const downloadHref = "/mom_report/report.html"

const navigation = [
  { name: "总览", href: "/ma/dashboard", icon: LayoutDashboard },
  { name: "宏观市场", href: "/ma/dashboard/macro-market", icon: TrendingUp },
  { name: "股票市场", href: "/ma/dashboard/stock-market", icon: LineChart },
  { name: "期货市场", href: "/ma/dashboard/futures-market", icon: Rocket },
  { name: "期权市场", href: "/ma/dashboard/options-market", icon: Target },
  { name: "私募基金", href: "/ma/dashboard/private-funds", icon: Briefcase },
  // Add cache-busting query to ensure latest assets load in new tab
  { name: "MOM 风控报告", href: momReportUrl, icon: FileText },
]

export function DashboardSidebar() {
  const pathname = usePathname()
  

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      <div className="p-6 border-b">
        <h2 className="text-lg font-semibold">市场监控</h2>
        <p className="text-sm text-muted-foreground">分析看板（传统风格）</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          const baseClasses = cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )

          if (item.name === "MOM 风控报告") {
            return (
              <div key={item.name} className={cn(baseClasses, "flex items-center justify-between gap-2")}>
                <Link
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  prefetch={false}
                  className="flex items-center gap-3"
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
                <Button asChild variant="ghost" size="sm" aria-label="下载 MOM 风控报告">
                  <a href={downloadHref} download>
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            )
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(baseClasses, "flex items-center gap-3")}
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
