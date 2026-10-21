"use client"

import { useEffect, useMemo, useState } from "react"
import type { MomUnderlyingAccountOption, MomUnderlyingKind, MomUnderlyingRow } from "@/lib/ma/mom-underlying"

type ProductHit = { beian_hao: string; product_name: string; short_name?: string | null }

function currentUserHeaders(): Record<string, string> {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

export function MomUnderlyingLinkDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  initial: MomUnderlyingRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [kind, setKind] = useState<MomUnderlyingKind>("compare")
  const [beian, setBeian] = useState("")
  const [productName, setProductName] = useState("")
  const [productQuery, setProductQuery] = useState("")
  const [productHits, setProductHits] = useState<ProductHit[]>([])
  const [productOpen, setProductOpen] = useState(false)
  const [account, setAccount] = useState("")
  const [accountFilter, setAccountFilter] = useState("")
  const [note, setNote] = useState("")
  const [options, setOptions] = useState<{ compare: MomUnderlyingAccountOption[]; account: MomUnderlyingAccountOption[] }>({ compare: [], account: [] })
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind(initial?.kind ?? "compare")
    setBeian(initial?.beian_hao ?? "")
    setProductName(initial?.product_name ?? "")
    setProductQuery(initial ? `${initial.product_name}${initial.beian_hao ? ` ${initial.beian_hao}` : ""}` : "")
    setProductHits([])
    setProductOpen(false)
    setAccount(initial?.account ?? "")
    setAccountFilter("")
    setNote(initial?.note ?? "")
    setError(null)
    setLoadingOptions(true)
    fetch("/ma/api/investment/mom-underlying/options", { headers: currentUserHeaders() })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error)
        setOptions({
          compare: Array.isArray(json.compare) ? json.compare : [],
          account: Array.isArray(json.account) ? json.account : [],
        })
      })
      .catch((e: Error) => setError(e.message || "账户列表加载失败"))
      .finally(() => setLoadingOptions(false))
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const q = productQuery.trim()
    if (q.length < 2 || (beian && q.includes(beian))) {
      setProductHits([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`)
        .then((r) => r.json())
        .then((rows) => setProductHits(Array.isArray(rows) ? rows : []))
        .catch(() => setProductHits([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [open, productQuery, beian])

  const accountOptions = kind === "compare" ? options.compare : options.account
  const filteredAccounts = useMemo(() => {
    const q = accountFilter.trim().toLowerCase()
    const list = accountOptions.filter((row) => !q || row.account.toLowerCase().includes(q) || row.label.toLowerCase().includes(q))
    if (account && !list.some((row) => row.account === account)) {
      list.unshift({ account, label: account })
    }
    return list
  }, [accountOptions, accountFilter, account])

  async function handleSave() {
    if (!beian) {
      setError("请选择产品")
      return
    }
    if (!account.trim()) {
      setError("请选择账户")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/ma/api/investment/mom-underlying/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...currentUserHeaders() },
        body: JSON.stringify({
          kind,
          beian_hao: beian,
          product_name: productName,
          account: account.trim(),
          note,
          previous: initial
            ? { kind: initial.kind, beian_hao: initial.beian_hao, account: initial.account, link_source: initial.link_source }
            : null,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!initial || initial.link_source !== "saved") return
    setSaving(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        kind: initial.kind,
        beian_hao: initial.beian_hao || "",
        account: initial.account,
      })
      const res = await fetch(`/ma/api/investment/mom-underlying/link?${qs}`, {
        method: "DELETE",
        headers: currentUserHeaders(),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除失败")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[520px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-base">{initial ? "修改关联" : "新增关联"}</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 text-sm">
          <p className="text-xs text-zinc-400 leading-relaxed">
            对比账户保存后，产品页「账户对比」默认使用该 MOM 账户。单账户把监控中心资金账号挂到这只产品上。
          </p>
          <div className="flex items-start gap-3">
            <span className="w-20 text-right shrink-0 pt-1.5">产品：</span>
            <div className="flex-1 relative">
              <input
                value={productQuery}
                onChange={(e) => {
                  setProductQuery(e.target.value)
                  setBeian("")
                  setProductName("")
                  setProductOpen(true)
                }}
                onFocus={() => setProductOpen(true)}
                placeholder="输入产品名称或备案号"
                className="w-full border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {beian && <div className="mt-1 text-xs text-zinc-400">{productName} · {beian}</div>}
              {productOpen && productHits.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border bg-background shadow-lg">
                  {productHits.map((hit) => (
                    <button
                      key={`${hit.beian_hao}-${hit.product_name}`}
                      type="button"
                      className="block w-full text-left px-3 py-2 hover:bg-muted text-xs"
                      onClick={() => {
                        setBeian(hit.beian_hao)
                        setProductName(hit.product_name)
                        setProductQuery(`${hit.product_name} ${hit.beian_hao}`)
                        setProductHits([])
                        setProductOpen(false)
                      }}
                    >
                      <span className="font-medium text-zinc-800">{hit.product_name}</span>
                      <span className="ml-2 text-zinc-400">{hit.beian_hao}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 text-right shrink-0">账户类型：</span>
            <div className="flex items-center gap-1">
              {([["compare", "对比账户"], ["account", "单账户"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setKind(key); setAccount("") }}
                  className={[
                    "px-2.5 py-1 rounded border text-xs",
                    kind === key ? "border-red-400 text-red-500 bg-red-50" : "border-border text-zinc-500",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 text-right shrink-0">筛选：</span>
            <input
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              placeholder={kind === "compare" ? "输入 MOM 账户，如 rx051" : "输入资金账号或期货公司"}
              className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 text-right shrink-0">账户：</span>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={loadingOptions}
              className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{loadingOptions ? "加载账户…" : "请选择账户"}</option>
              {filteredAccounts.map((row) => (
                <option key={row.account} value={row.account}>{row.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-20 text-right shrink-0 pt-1.5">备注：</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选"
              maxLength={255}
              className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {initial?.link_source === "matched" && (
            <div className="text-xs text-zinc-400 pl-[5.75rem]">当前按结算单客户名称自动对应。保存后改为手工关联。</div>
          )}
          {initial?.link_source === "static" && (
            <div className="text-xs text-zinc-400 pl-[5.75rem]">当前是内置关联。保存后以这里的账户为准。</div>
          )}
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
          {initial?.link_source === "saved" && (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="mr-auto px-3 py-1.5 text-sm rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            >
              解除关联
            </button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50">取消</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingOptions}
            className="px-3 py-1.5 text-sm rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}
