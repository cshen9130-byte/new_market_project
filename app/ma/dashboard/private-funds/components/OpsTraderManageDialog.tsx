"use client"

import { useEffect, useMemo, useState } from "react"

function currentUserHeaders(): Record<string, string> {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

type LinkRow = {
  beian_hao: string
  product_name: string
  account_code: string
  note: string
  updated_by: string
  updated_at: string
}

export function OpsTraderManageDialog({
  open,
  beian_hao,
  product_name,
  onClose,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState("")
  const [note, setNote] = useState("")
  const [filter, setFilter] = useState("")
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([])
  const [saved, setSaved] = useState<LinkRow | null>(null)

  useEffect(() => {
    if (!open || !beian_hao) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setFilter("")
    const qs = new URLSearchParams({ beian_hao, product_name })
    fetch(`/ma/api/ops/fund-mom-accounts?${qs}`, { headers: currentUserHeaders() })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) {
          setError(json.error)
          return
        }
        const row = json.data as LinkRow | null
        setSaved(row)
        setAccount(row?.account_code || json.defaultAccount || "")
        setNote(row?.note || "")
        setAvailableAccounts(Array.isArray(json.availableAccounts) ? json.availableAccounts : [])
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, beian_hao, product_name])

  const filteredAccounts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = availableAccounts.slice()
    if (account && !list.includes(account)) list.unshift(account)
    if (!q) return list
    return list.filter((acc) => acc.includes(q))
  }, [availableAccounts, filter, account])

  async function handleSave() {
    if (!beian_hao || !account.trim()) {
      setError("请选择 MOM 账户")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/ma/api/ops/fund-mom-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...currentUserHeaders() },
        body: JSON.stringify({
          beian_hao,
          product_name,
          account_code: account.trim(),
          note,
          user_name: (() => {
            try {
              const u = JSON.parse(localStorage.getItem("currentUser") || "null")
              return u?.name || u?.email || ""
            } catch {
              return ""
            }
          })(),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setSaved(json.data)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!beian_hao) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/ops/fund-mom-accounts?beian_hao=${encodeURIComponent(beian_hao)}`, {
        method: "DELETE",
        headers: currentUserHeaders(),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setSaved(null)
      setAccount("")
      setNote("")
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
        className="bg-background rounded-lg shadow-xl w-full max-w-[480px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-base">盘手管理</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="text-sm text-zinc-600">
            产品：<span className="font-medium text-zinc-800">{product_name || beian_hao}</span>
            {beian_hao && <span className="ml-2 text-zinc-400">{beian_hao}</span>}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            将产品关联到 MOM 结算账户。保存后，产品页「账户对比」默认使用该账户。
          </p>
          {loading ? (
            <div className="text-sm text-zinc-400 py-6 text-center">加载账户列表…</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm w-20 text-right shrink-0">筛选：</span>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="输入账户代码筛选"
                  className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm w-20 text-right shrink-0">MOM 账户：</span>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">请选择账户</option>
                  {filter.trim() && !filteredAccounts.includes(filter.trim().toLowerCase()) && (
                    <option value={filter.trim().toLowerCase()}>使用 {filter.trim().toLowerCase()}</option>
                  )}
                  {filteredAccounts.map((acc) => (
                    <option key={acc} value={acc}>{acc}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm w-20 text-right shrink-0 pt-1.5">备注：</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="可选，例如同一投顾"
                  maxLength={255}
                  className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {saved?.account_code && (
                <div className="text-xs text-zinc-400 pl-[5.5rem]">
                  当前已关联 {saved.account_code}
                  {saved.updated_by ? ` · ${saved.updated_by}` : ""}
                  {saved.updated_at ? ` · ${String(saved.updated_at).slice(0, 16).replace("T", " ")}` : ""}
                </div>
              )}
            </>
          )}
          {error && <div className="text-sm text-red-500">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
          <button
            type="button"
            onClick={handleClear}
            disabled={saving || loading || !saved}
            className="px-3 py-1.5 text-sm rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            解除关联
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !account}
            className="px-3 py-1.5 text-sm rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}
