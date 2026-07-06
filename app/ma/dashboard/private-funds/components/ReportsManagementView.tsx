"use client"

import { useCallback, useMemo, useState } from "react"
import { Inbox, Search } from "lucide-react"
import { NewReportDialog } from "./NewReportDialog"
import { loadCustomReports, type SavedCustomReport } from "@/lib/ma/custom-report-storage"

type ScopeTab = "team" | "mine"

const thBase = "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

function currentUserName(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name ?? u?.email ?? ""
  } catch {
    return ""
  }
}

export function ReportsManagementView() {
  const [scopeTab, setScopeTab] = useState<ScopeTab>("team")
  const [keyword, setKeyword] = useState("")
  const [newReportOpen, setNewReportOpen] = useState(false)
  const [reports, setReports] = useState<SavedCustomReport[]>(() => loadCustomReports())

  const refreshReports = useCallback(() => {
    setReports(loadCustomReports())
  }, [])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const mine = currentUserName()
    return reports.filter((r) => {
      if (scopeTab === "mine" && r.creator && mine && r.creator !== mine) return false
      if (!q) return true
      return r.title.toLowerCase().includes(q) || r.templateName.toLowerCase().includes(q)
    })
  }, [reports, keyword, scopeTab])

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setScopeTab(t)}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              scopeTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队报告" : "我的报告"}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="请输入报告名称进行搜索"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setNewReportOpen(true)}
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors shrink-0"
        >
          新建报告
        </button>
      </div>

      <NewReportDialog
        open={newReportOpen}
        onClose={() => setNewReportOpen(false)}
        onCustomReportSaved={refreshReports}
      />

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                <th className={`${thBase} w-16 text-center`}>序号</th>
                <th className={thBase}>标题</th>
                <th className={thBase}>模板</th>
                <th className={thBase}>创建日期</th>
                <th className={thBase}>创建人</th>
                <th className={`${thBase} w-20 text-center`}>类型</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="h-48">
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                      <span className="text-sm">暂无数据</span>
                      <span className="text-xs text-zinc-400">新建报告 → 自定义报告，使用模板管理中的模板</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-3 text-center text-zinc-500 text-xs">{i + 1}</td>
                    <td className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-200">{r.title}</td>
                    <td className="px-3 py-3 text-zinc-500 text-xs">{r.templateName}</td>
                    <td className="px-3 py-3 text-zinc-500 text-xs">
                      {new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="px-3 py-3 text-zinc-500 text-xs">{r.creator || "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                        自定义
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
