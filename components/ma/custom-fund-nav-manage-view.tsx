"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Inbox, MinusCircle, Pencil, Trash2, Upload } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { CustomFundNavUploadDialog } from "@/components/ma/custom-fund-nav-upload-dialog"
import { CustomFundNavGenerationRulesDialog } from "@/components/ma/custom-fund-nav-generation-rules-dialog"

type NavRow = {
  id: string
  nav_date: string
  unit_nav: string
  cumulative_nav: string
  adjusted_nav: string | null
  price_change: string | null
  nav_source: string
}

type FundMeta = {
  product_code: string
  product_name: string
  scope: "team" | "mine"
}

function userFetchHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

function pctColor(value: string | null): string | undefined {
  if (!value) return undefined
  if (value.startsWith("+")) return "#ef4444"
  if (value.startsWith("-")) return "#16a34a"
  return undefined
}

export function customFundNavManageHref(productCode: string): string {
  return `/ma/dashboard/private-funds/custom/${encodeURIComponent(productCode)}/nav`
}

export function CustomFundNavManageView({ productCode }: { productCode: string }) {
  const router = useRouter()
  const [fund, setFund] = useState<FundMeta | null>(null)
  const [rows, setRows] = useState<NavRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const navigateFunds = useCallback((tab: string, side?: string) => {
    const sideItem = side ?? (tab === "funds" ? "custom-funds" : "private-funds")
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/custom-funds/nav/list?code=${encodeURIComponent(productCode)}`, {
        headers: userFetchHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setFund(json.fund ?? null)
      setRows(Array.isArray(json.rows) ? json.rows : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [productCode])

  useEffect(() => {
    loadRows()
  }, [loadRows, reloadKey])

  async function handleUpload(uploadRows: Array<{ nav_date: string; unit_nav: string; cumulative_nav: string }>) {
    const res = await fetch("/ma/api/custom-funds/nav/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userFetchHeaders() },
      body: JSON.stringify({ code: productCode, rows: uploadRows }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error === "invalid_rows" ? "净值格式不正确" : "上传失败")
    }
    setReloadKey((k) => k + 1)
  }

  async function handleClear() {
    const res = await fetch("/ma/api/custom-funds/nav/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userFetchHeaders() },
      body: JSON.stringify({ code: productCode }),
    })
    if (!res.ok) throw new Error("清空失败")
    setShowClear(false)
    setReloadKey((k) => k + 1)
  }

  async function handleDelete(rowId: string) {
    if (!window.confirm("确定删除该条净值？")) return
    const res = await fetch("/ma/api/custom-funds/nav/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userFetchHeaders() },
      body: JSON.stringify({ code: productCode, id: rowId }),
    })
    if (!res.ok) return
    setReloadKey((k) => k + 1)
  }

  function handleExport() {
    const headers = ["净值日期", "单位净值", "累计净值", "复权净值", "涨跌幅", "净值来源"]
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [headers.join(",")]
    for (const row of rows) {
      lines.push([
        escape(row.nav_date),
        escape(row.unit_nav),
        escape(row.cumulative_nav),
        escape(row.adjusted_nav ?? ""),
        escape(row.price_change ?? ""),
        escape(row.nav_source),
      ].join(","))
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${fund?.product_name ?? productCode}_净值_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const scopeNote = fund?.scope === "mine"
    ? "我的自建版本仅本人可见，净值如更新，会重新计算复权净值，可5分钟后刷新查看。"
    : "团队自建版本团队内访客可见，净值如更新，会重新计算复权净值，可5分钟后刷新查看。"
  const hasRuleGeneratedNav = rows.some((row) => row.nav_source === "规则生成")

  return (
    <FundDatabaseShell activeSideItem="custom-funds" onNavigate={navigateFunds}>
      <div className="flex flex-col min-h-full">
        <button
          type="button"
          onClick={() => navigateFunds("funds", "custom-funds")}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors w-fit"
        >
          ← 返回自建基金
        </button>

        <h1 className="text-xl font-semibold text-foreground">自建基金</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {fund?.product_name ? `${fund.product_name} · ` : ""}基金ID：{productCode}
        </p>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">*说明：{scopeNote}</p>

        <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-red-500">净值列表</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <button
              type="button"
              disabled={!rows.length}
              onClick={() => setShowClear(true)}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <MinusCircle className="h-3.5 w-3.5" /> 清空净值
            </button>
            <button
              type="button"
              disabled={!rows.length}
              onClick={handleExport}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> 导出
            </button>
            <button
              type="button"
              onClick={() => setShowRules(true)}
              className="inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium border border-red-400 text-red-500 hover:bg-red-50 transition-colors"
            >
              净值生成规则
            </button>
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors"
            >
              <Upload className="h-3.5 w-3.5" /> 上传净值
            </button>
          </div>
        </div>

        {hasRuleGeneratedNav && (
          <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            系统根据多基金拼接自动生成了净值。
          </div>
        )}

        <div className="mt-4 overflow-auto rounded-lg border flex-1 min-h-[360px] bg-background">
          <table className="text-sm border-collapse w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/40 border-b">
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-32">净值日期</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">单位净值</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">累计净值</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">复权净值</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-24">涨跌幅</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">净值来源</th>
                <th className="px-4 py-2.5 text-center font-semibold text-zinc-500 w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center text-muted-foreground">加载中…</td></tr>
              ) : error ? (
                <tr><td colSpan={8} className="py-16 text-center text-red-500">加载失败：{error}</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                      <span>暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.nav_date}</td>
                  <td className="px-4 py-2.5 tabular-nums font-medium">{row.unit_nav}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.cumulative_nav}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.adjusted_nav ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: pctColor(row.price_change) }}>
                    {row.price_change ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">{row.nav_source}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" title="编辑" className="p-1 rounded hover:bg-muted text-muted-foreground" disabled>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="删除" onClick={() => handleDelete(row.id)} className="p-1 rounded hover:bg-muted text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CustomFundNavGenerationRulesDialog
        open={showRules}
        productCode={productCode}
        onClose={() => setShowRules(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      <CustomFundNavUploadDialog
        open={showUpload}
        scope={fund?.scope ?? "team"}
        onClose={() => setShowUpload(false)}
        onUpload={handleUpload}
      />

      {showClear && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-background shadow-xl border p-4">
            <p className="text-sm font-semibold mb-2">清空净值</p>
            <p className="text-xs text-muted-foreground mb-4">确定清空该产品的全部净值数据？此操作不可恢复。</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowClear(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-muted">取消</button>
              <button type="button" onClick={handleClear} className="px-3 py-1.5 text-sm rounded bg-red-500 hover:bg-red-600 text-white">确认清空</button>
            </div>
          </div>
        </div>
      )}
    </FundDatabaseShell>
  )
}
