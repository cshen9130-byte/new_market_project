"use client"

import type { ReactNode } from "react"
import { BarChart2 } from "lucide-react"

const menuItems = [
  { key: "market", label: "市场", href: "/ma/dashboard/private-funds?tab=market&side=strategy-observation" },
  { key: "funds", label: "基金", href: "/ma/dashboard/private-funds?tab=funds" },
  { key: "portfolio", label: "组合", href: "/ma/dashboard/private-funds?tab=portfolio&side=port-new" },
  { key: "investment", label: "投资", href: "/ma/dashboard/private-funds?tab=investment&side=inv-compare" },
  { key: "operations", label: "运维", href: "/ma/dashboard/private-funds?tab=operations" },
  { key: "instructions", label: "指令", href: "/ma/dashboard/private-funds?tab=instructions&side=cmd-initiate" },
  { key: "reports", label: "报告", href: "/ma/dashboard/private-funds?tab=reports&side=rpt-mine" },
]

const investmentSidebarGroups = [
  {
    label: "尽调池",
    items: [
      { key: "inv-dd-table", label: "尽调表格", href: "/ma/dashboard/private-funds?tab=investment&side=inv-dd-table" },
      { key: "inv-dd-calendar", label: "尽调日历", href: "/ma/dashboard/private-funds?tab=investment&side=inv-dd-calendar" },
      { key: "inv-dd-report", label: "尽调报告", href: "/ma/dashboard/private-funds?tab=investment&side=inv-dd-report" },
      { key: "inv-dd-notes", label: "投资笔记", href: "/ma/dashboard/private-funds?tab=investment&side=inv-dd-notes" },
    ],
  },
  {
    label: "跟踪池",
    items: [
      { key: "inv-tracking", label: "跟踪产品", href: "/ma/dashboard/private-funds?tab=investment&side=inv-tracking" },
      { key: "inv-tracking-mgr", label: "跟踪管理人", href: "/ma/dashboard/private-funds?tab=investment&side=inv-tracking-mgr" },
      { key: "inv-compare", label: "基金对比", href: "/ma/dashboard/private-funds?tab=investment&side=inv-compare" },
    ],
  },
  {
    label: "投资池",
    items: [
      { key: "inv-overview", label: "投资概览", href: "/ma/dashboard/private-funds?tab=investment&side=inv-overview" },
      { key: "inv-active", label: "在管产品", href: "/ma/dashboard/private-funds?tab=investment&side=inv-active" },
      { key: "inv-fof", label: "FOF底层", href: "/ma/dashboard/private-funds?tab=investment&side=inv-fof" },
      { key: "inv-docs", label: "资料列表", href: "/ma/dashboard/private-funds?tab=investment&side=inv-docs" },
    ],
  },
  {
    label: "直投池",
    items: [
      { key: "inv-direct", label: "直投产品", href: "/ma/dashboard/private-funds?tab=investment&side=inv-direct" },
      { key: "inv-direct-portfolio", label: "直投组合", href: "/ma/dashboard/private-funds?tab=investment&side=inv-direct-portfolio" },
    ],
  },
]

export function FundCompareSectionShell({
  children,
  activeSideItem = "inv-compare",
}: {
  children: ReactNode
  activeSideItem?: string
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden -mx-4 md:-mx-6 -mt-0 -mb-6">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={[
                "relative px-4 h-12 inline-flex items-center text-sm font-medium transition-colors",
                item.key === "investment"
                  ? "text-red-600 dark:text-red-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500 after:rounded-full"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="flex flex-1 min-h-0">
        <aside className="w-44 border-r bg-background flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-4 border-b">
            <div className="h-7 w-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
              <BarChart2 className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-foreground">投资分析</span>
          </div>
          <nav className="flex flex-col pt-3 pb-4">
            {investmentSidebarGroups.map((group) => {
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
                    <a
                      key={item.key}
                      href={item.href}
                      className={[
                        "block w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors relative",
                        activeSideItem === item.key
                          ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:right-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                      ].join(" ")}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-background overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
