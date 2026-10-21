"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown, Download, Plus, Search } from "lucide-react"
import { FundProductNameLink } from "@/components/ma/copyable-inline-text"
import type { MomUnderlyingKind, MomUnderlyingRow } from "@/lib/ma/mom-underlying"
import { MomUnderlyingLinkDialog } from "./MomUnderlyingLinkDialog"

type KindFilter = "all" | MomUnderlyingKind
type SortKey = "product_name" | "beian_hao" | "kind" | "account" | "latest_nav_date" | "latest_nav" | "latest_price_change" | "equity"

const KIND_LABEL: Record<MomUnderlyingKind, string> = {
  compare: "对比账户",
  account: "单账户",
}

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"

function fmtNav(value: string | null): string {
  if (!value) return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(4)
}

function fmtEquity(value: string | null): string {
  if (!value) return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(value: string | null): { text: string; cls: string } {
  if (!value) return { text: "—", cls: "text-muted-foreground" }
  const n = Number(value)
  if (!Number.isFinite(n)) return { text: "—", cls: "text-muted-foreground" }
  const pct = n * 100
  const text = `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`
  const cls = pct > 0 ? "text-red-500" : pct < 0 ? "text-green-600" : "text-foreground"
  return { text, cls }
}

function compareValues(a: MomUnderlyingRow, b: MomUnderlyingRow, key: SortKey): number {
  const av = a[key] ?? ""
  const bv = b[key] ?? ""
  if (key === "latest_nav" || key === "latest_price_change" || key === "equity") {
    const an = av === "" ? Number.NEGATIVE_INFINITY : Number(av)
    const bn = bv === "" ? Number.NEGATIVE_INFINITY : Number(bv)
    return (Number.isFinite(an) ? an : Number.NEGATIVE_INFINITY) - (Number.isFinite(bn) ? bn : Number.NEGATIVE_INFINITY)
  }
  return String(av).localeCompare(String(bv), "zh")
}

export function InvestmentMomUnderlyingView() {
  const [rows, setRows] = useState<MomUnderlyingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<KindFilter>("all")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("product_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkRow, setLinkRow] = useState<MomUnderlyingRow | null>(null)
  const pageSize = 50

  const loadRows = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    fetch("/ma/api/investment/mom-underlying/list", { signal })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error || "加载失败")
        setRows(Array.isArray(json.data) ? json.data : [])
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return
        setError(err.message || "加载失败")
        setRows([])
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    loadRows(ac.signal)
    return () => ac.abort()
  }, [loadRows, reloadKey])

  const counts = useMemo(() => ({
    all: rows.length,
    compare: rows.filter((r) => r.kind === "compare").length,
    account: rows.filter((r) => r.kind === "account").length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const list = rows.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false
      if (!q) return true
      return [row.product_name, row.beian_hao, row.account, row.account_note, row.strategy]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    })
    const dir = sortDir === "asc" ? 1 : -1
    return [...list].sort((a, b) => compareValues(a, b, sortKey) * dir || a.account.localeCompare(b.account))
  }, [rows, kind, keyword, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "product_name" || key === "beian_hao" || key === "account" || key === "kind" ? "asc" : "desc")
    }
    setPage(1)
  }

  function exportCsv() {
    const escape = (v: string | null | undefined) => {
      const s = v ?? ""
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const headers = ["产品名称", "备案号", "账户类型", "账户", "账户说明", "策略", "最新净值日期", "最新单位净值", "最新涨跌幅", "最新权益", "权益日期"]
    const lines = [
      headers.join(","),
      ...filtered.map((row) => [
        escape(row.product_name),
        escape(row.beian_hao),
        escape(KIND_LABEL[row.kind]),
        escape(row.account),
        escape(row.account_note),
        escape(row.strategy),
        escape(row.latest_nav_date),
        escape(row.latest_nav),
        escape(fmtPct(row.latest_price_change).text === "—" ? "" : fmtPct(row.latest_price_change).text),
        escape(row.equity),
        escape(row.equity_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `MOM底层_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function SortTh({ label, col, className }: { label: string; col: SortKey; className?: string }) {
    const active = sortKey === col
    const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown
    return (
      <th className={`${thBase} cursor-pointer select-none hover:text-zinc-800 ${className ?? ""}`} onClick={() => toggleSort(col)}>
        <span className="inline-flex items-center gap-1">
          {label}
          <Icon className={`h-3 w-3 ${active ? "text-red-500" : "text-zinc-300"}`} />
        </span>
      </th>
    )
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 mb-3 border-b flex-shrink-0">
        <div className="px-4 py-2 text-sm font-medium text-red-500 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500">
          MOM底层
        </div>
      </div>

      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">账户类型：</span>
          <div className="flex items-center gap-1">
            {([
              ["all", `全部 ${counts.all}`],
              ["compare", `对比账户 ${counts.compare}`],
              ["account", `单账户 ${counts.account}`],
            ] as const).map(([key, label]) => (
              <span
                key={key}
                onClick={() => { setKind(key); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                  kind === key
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2 gap-6 flex-wrap">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
            <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
              <input
                className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                placeholder="产品、备案号或账户，按回车搜索"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setKeyword(kwInput)
                    setPage(1)
                  }
                }}
              />
              <button
                onClick={() => { setKeyword(kwInput); setPage(1) }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Search className="h-3 w-3" />
              </button>
            </div>
          </div>
          <span className="text-zinc-400">
            在本页把产品关联到对比账户或单账户。对比账户会作为产品页账户对比的默认账户。
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <span className="text-xs text-zinc-500">共 {filtered.length} 条</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLinkRow(null); setLinkOpen(true) }}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-red-500 text-xs text-white hover:bg-red-600"
          >
            <Plus className="h-3 w-3" />
            新增关联
          </button>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded border text-xs text-zinc-600 hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border rounded-xl bg-background">
        <table className="w-full text-xs border-collapse min-w-[1100px]">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className={`${thBase} w-12`}>序号</th>
              <SortTh label="产品名称" col="product_name" />
              <SortTh label="备案号" col="beian_hao" />
              <SortTh label="账户类型" col="kind" />
              <SortTh label="账户" col="account" />
              <th className={thBase}>账户说明</th>
              <th className={thBase}>策略</th>
              <SortTh label="最新净值日期" col="latest_nav_date" />
              <SortTh label="最新单位净值" col="latest_nav" className="text-right" />
              <SortTh label="最新涨跌幅" col="latest_price_change" className="text-right" />
              <SortTh label="最新权益" col="equity" className="text-right" />
              <th className={`${thBase} text-center`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-4 py-16 text-center text-zinc-400">加载中…</td></tr>
            ) : error ? (
              <tr><td colSpan={12} className="px-4 py-16 text-center text-red-500">{error}</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-16 text-center text-zinc-400">暂无关联产品</td></tr>
            ) : pageRows.map((row, i) => {
              const pct = fmtPct(row.latest_price_change)
              return (
                <tr key={row.id} className="border-t hover:bg-muted/40">
                  <td className="px-3 py-2 text-zinc-400">{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-3 py-2">
                    <FundProductNameLink beian_hao={row.beian_hao} product_name={row.product_name} />
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{row.beian_hao || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={[
                      "inline-flex px-1.5 py-0.5 rounded border",
                      row.kind === "compare"
                        ? "border-blue-200 text-blue-600 bg-blue-50"
                        : "border-amber-200 text-amber-700 bg-amber-50",
                    ].join(" ")}>
                      {KIND_LABEL[row.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-800">{row.account}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.account_note || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.strategy || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.latest_nav_date || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNav(row.latest_nav)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${pct.cls}`}>{pct.text}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title={row.equity_date || undefined}>{fmtEquity(row.equity)}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => { setLinkRow(row); setLinkOpen(true) }}
                      className="text-blue-600 hover:underline"
                    >
                      {row.link_source === "saved" ? "编辑" : "关联"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <MomUnderlyingLinkDialog
        open={linkOpen}
        initial={linkRow}
        onClose={() => setLinkOpen(false)}
        onSaved={() => setReloadKey((n) => n + 1)}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-2 text-xs text-zinc-500">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7 px-2 rounded border disabled:opacity-40">上一页</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-7 px-2 rounded border disabled:opacity-40">下一页</button>
        </div>
      )}
    </div>
  )
}
