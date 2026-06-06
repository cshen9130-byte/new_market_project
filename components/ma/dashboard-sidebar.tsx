"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { TrendingUp, LineChart, Rocket, Target, Briefcase, LayoutDashboard, BrainCircuit, Home, Wrench, BarChart2, ChevronLeft, ChevronRight, X } from "lucide-react"
import type React from "react"
import { authService } from "@/lib/auth"

const baseNavigation = [
  { name: "总览", href: "/ma/dashboard", icon: LayoutDashboard },
  { name: "宏观市场", href: "/ma/dashboard/macro-market", icon: TrendingUp },
  { name: "股票市场", href: "/ma/dashboard/stock-market", icon: LineChart },
  { name: "期货市场", href: "/ma/dashboard/futures-market", icon: Rocket },
  { name: "期权市场", href: "/ma/dashboard/options-market", icon: Target },
  { name: "私募基金", href: "/ma/dashboard/private-funds", icon: Briefcase },
  { name: "MOM分析", href: "/ma/dashboard/mom-analysis", icon: BarChart2, permKey: "mom" as const },
  { name: "小工具", href: "/ma/dashboard/tools", icon: Wrench },
  { name: "__home__", href: "/ma/dashboard", icon: Home },
  { name: "AI知识库", href: "/ma/dashboard/ai-knowledge", icon: BrainCircuit },
]

interface DashboardSidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function DashboardSidebar({ mobileOpen = false, onMobileClose }: DashboardSidebarProps) {
  const pathname = usePathname()
  const currentUser = authService.getCurrentUser()
  const navigation = baseNavigation.filter((item) => {
    if (!item.permKey) return true
    if (currentUser?.role === "admin") return true
    return !!currentUser?.permissions?.[item.permKey]
  })
  const shouldAutoCollapse =
    pathname === "/ma/dashboard/ai-knowledge" ||
    pathname === "/ma/dashboard/private-funds" ||
    pathname.startsWith("/ma/dashboard/private-funds/") ||
    pathname.startsWith("/ma/dashboard/settings") ||
    pathname.startsWith("/ma/dashboard/mom-analysis/trader-analysis") ||
    pathname.startsWith("/ma/dashboard/mom-analysis/risk-report")
  const [isCollapsed, setIsCollapsed] = useState(false)
  const previousManualCollapsedRef = useRef<boolean | null>(null)
  const previousAutoCollapseRef = useRef(shouldAutoCollapse)

  useEffect(() => {
    if (shouldAutoCollapse) {
      if (!previousAutoCollapseRef.current) {
        previousManualCollapsedRef.current = isCollapsed
      }
      setIsCollapsed(true)
    } else if (previousAutoCollapseRef.current) {
      setIsCollapsed(previousManualCollapsedRef.current ?? false)
      previousManualCollapsedRef.current = null
    }

    previousAutoCollapseRef.current = shouldAutoCollapse
  }, [shouldAutoCollapse])

  const sidebarContent = (
    <aside className={cn("border-r bg-card flex flex-col transition-all duration-200 h-full", isCollapsed ? "w-12" : "w-56")}>
      <div className={cn("border-b", isCollapsed ? "px-2 py-5" : "px-4 py-5")}>
        {isCollapsed ? (
          <Link href="/ma/dashboard" title="返回主页" className="flex flex-col items-center gap-1 hover:text-primary transition-colors">
            <Home className="h-5 w-5" />
            <div className="text-xs font-semibold">主页</div>
          </Link>
        ) : (
          <>
            <h2 className="text-sm font-semibold leading-snug">母基金AI投研系统</h2>
            <p className="text-xs text-muted-foreground mt-0.5">分析看板（传统风格）</p>
          </>
        )}
      </div>
      <nav className={cn("flex-1 space-y-1", isCollapsed ? "p-1.5" : "p-3")}>
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
                onClick={onMobileClose}
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
              onClick={onMobileClose}
            >
              <item.icon className="h-4 w-4" />
              {!isCollapsed && item.name}
            </Link>
          )
        })}
      </nav>
      <div className={cn("border-t p-2", isCollapsed ? "flex justify-center" : "flex justify-end")}>
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          title={isCollapsed ? "展开侧栏" : "收起侧栏"}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        {sidebarContent}
      </div>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onMobileClose}
          />
          {/* Drawer panel */}
          <div className="relative flex h-full w-64 flex-col bg-card shadow-xl">
            <button
              onClick={onMobileClose}
              className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors z-10"
              title="关闭菜单"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold">母基金AI投研系统</h2>
              <p className="text-sm text-muted-foreground">分析看板（传统风格）</p>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
              {navigation.map((item) => {
                if (item.name === "__home__") return null
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
                    onClick={onMobileClose}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
