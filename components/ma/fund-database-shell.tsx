"use client"

import type React from "react"
import { Database } from "lucide-react"

const menuItems = [
  { key: "market", label: "市场" },
  { key: "funds", label: "基金" },
  { key: "portfolio", label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
]

const fundsSidebarGroups = [
  {
    label: "私募数据库",
    items: [
      { key: "private-funds", label: "私募基金" },
      { key: "fund-managers-org", label: "私募管理人" },
      { key: "fund-managers", label: "基金经理" },
    ],
  },
  {
    label: "自建数据库",
    items: [
      { key: "custom-funds", label: "自建基金" },
      { key: "custom-index", label: "自建指数" },
    ],
  },
]

export function FundDatabaseShell({
  children,
  activeSideItem = "private-funds",
  onNavigate,
}: {
  children: React.ReactNode
  activeSideItem?: string
  onNavigate: (tab: string, side?: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => item.key !== "funds" && onNavigate(item.key)}
              className={[
                "relative px-4 h-full text-sm font-medium transition-colors focus:outline-none",
                item.key === "funds"
                  ? "text-red-600 dark:text-red-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500 after:rounded-full"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-44 border-r bg-background flex-shrink-0 hidden md:block">
          <div className="flex items-center gap-2 px-4 py-4 border-b">
            <div className="h-7 w-7 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0">
              <Database className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-foreground">基金数据库</span>
          </div>
          <nav className="flex flex-col pt-2 pb-4 overflow-y-auto">
            {fundsSidebarGroups.map((group) => {
              const hasActive = group.items.some((i) => i.key === activeSideItem)
              return (
                <div key={group.label}>
                  <div
                    className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onNavigate("funds", item.key)}
                      className={[
                        "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                        item.key === activeSideItem
                          ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>
        <div className="flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto p-5 pb-16">{children}</div>
      </div>
    </div>
  )
}
