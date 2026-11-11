"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, X } from "lucide-react"

const MAX_VIEW_LENGTH = 800

const VOL_BANDS = ["低波", "中波", "高波"] as const
type VolBand = (typeof VOL_BANDS)[number]

type ManagerViewTemplate = {
  id: string
  name: string
  text: string
}

type ManagerViewProduct = {
  product_name: string
  beian_hao: string | null
  source?: string
  hasView?: boolean
  templateId?: string | null
  text?: string
  volBand?: VolBand
}

type RegenJob = {
  id: string
  status: "running" | "done" | "error"
  total: number
  done: number
  updated: number
  failed: Array<{ product_name: string; error: string }>
  error?: string
}

function userFetchHeaders(): Record<string, string> {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

function productKey(p: { product_name: string; beian_hao?: string | null }): string {
  const code = (p.beian_hao || "").trim().toUpperCase()
  if (code) return `code:${code}`
  return `name:${(p.product_name || "").trim()}`
}

function productVolBand(p: ManagerViewProduct): VolBand {
  if (p.volBand === "低波" || p.volBand === "中波" || p.volBand === "高波") return p.volBand
  const code = (p.beian_hao || "").trim().toUpperCase()
  return code === "SGM223" ? "中波" : "低波"
}

export function ManagerViewDialog({
  open,
  fallbackProducts,
  onClose,
  onUpdated,
}: {
  open: boolean
  fallbackProducts?: Array<{ product_name: string; beian_hao: string | null }>
  onClose: () => void
  onUpdated?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ManagerViewTemplate[]>([])
  const [products, setProducts] = useState<ManagerViewProduct[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [templateName, setTemplateName] = useState("")
  const [query, setQuery] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [bandFilter, setBandFilter] = useState<Set<VolBand>>(new Set())
  const [job, setJob] = useState<RegenJob | null>(null)

  async function loadSnapshot() {
    setLoading(true)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/manager-views", {
        headers: userFetchHeaders(),
        cache: "no-store",
      })
      const json = (await resp.json().catch(() => ({}))) as {
        error?: string
        templates?: ManagerViewTemplate[]
        products?: ManagerViewProduct[]
      }
      if (!resp.ok) throw new Error(json.error || "加载失败")
      setTemplates(json.templates || [])
      const rows = json.products || []
      setProducts(rows.length > 0 ? rows : (fallbackProducts || []).map((p) => ({ ...p, hasView: false })))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "加载失败")
      if (fallbackProducts?.length) {
        setProducts(fallbackProducts.map((p) => ({ ...p, hasView: false })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setMessage(null)
      setQuery("")
      setJob(null)
      setBusy(false)
      return
    }
    setSelectedTemplateId(null)
    setText("")
    setTemplateName("")
    setSelectedKeys(new Set())
    setBandFilter(new Set())
    void loadSnapshot()
  }, [open])

  useEffect(() => {
    if (!job || job.status !== "running") return
    let cancelled = false
    const timer = window.setInterval(() => {
      void (async () => {
        const resp = await fetch(`/ma/api/reports/auto-weekly/manager-views?jobId=${encodeURIComponent(job.id)}`, {
          headers: userFetchHeaders(),
          cache: "no-store",
        })
        const json = (await resp.json().catch(() => ({}))) as { job?: RegenJob; error?: string }
        if (cancelled || !json.job) return
        setJob(json.job)
        if (json.job.status !== "running") {
          onUpdated?.()
          if (json.job.status === "done") {
            const fail = json.job.failed.length
            setMessage(
              fail
                ? `已更新 ${json.job.updated} 份持仓版，${fail} 个失败`
                : `已更新 ${json.job.updated} 份最新一周持仓版`,
            )
          } else {
            setMessage(json.job.error || "更新报告失败")
          }
        }
      })()
    }, 1200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [job, onUpdated])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (bandFilter.size > 0 && !bandFilter.has(productVolBand(p))) return false
      if (!q) return true
      return [p.product_name, p.beian_hao].filter(Boolean).join(" ").toLowerCase().includes(q)
    })
  }, [products, query, bandFilter])

  function toggleBand(band: VolBand) {
    setBandFilter((current) => {
      const next = new Set(current)
      if (next.has(band)) next.delete(band)
      else next.add(band)
      return next
    })
  }

  function toggleKey(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectFiltered(all: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current)
      for (const p of filtered) {
        const key = productKey(p)
        if (all) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  function applyTemplate(template: ManagerViewTemplate | null) {
    setSelectedTemplateId(template?.id ?? null)
    if (template) {
      setText(template.text)
      setTemplateName(template.name)
    }
  }

  async function post(body: Record<string, unknown>) {
    const resp = await fetch("/ma/api/reports/auto-weekly/manager-views", {
      method: "POST",
      headers: { ...userFetchHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = (await resp.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      updated?: number
      job?: RegenJob
      templates?: ManagerViewTemplate[]
      products?: ManagerViewProduct[]
      template?: ManagerViewTemplate
    }
    if (!resp.ok || json.ok === false) throw new Error(json.error || "保存失败")
    if (json.templates) setTemplates(json.templates)
    if (json.products) setProducts(json.products)
    return json
  }

  async function saveTemplate() {
    const name = templateName.trim()
    if (!name) {
      setMessage("请填写模板名称")
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const json = await post({
        action: "upsertTemplate",
        id: selectedTemplateId || undefined,
        name,
        text,
      })
      if (json.template) {
        setSelectedTemplateId(json.template.id)
        setTemplateName(json.template.name)
      }
      setMessage("模板已保存")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存模板失败")
    } finally {
      setBusy(false)
    }
  }

  async function removeTemplate() {
    if (!selectedTemplateId) return
    setBusy(true)
    setMessage(null)
    try {
      await post({ action: "deleteTemplate", id: selectedTemplateId })
      setSelectedTemplateId(null)
      setMessage("模板已删除")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除模板失败")
    } finally {
      setBusy(false)
    }
  }

  async function assign(applyAll: boolean) {
    const targets = applyAll
      ? products
      : products.filter((p) => selectedKeys.has(productKey(p)))
    if (targets.length === 0) {
      setMessage(applyAll ? "暂无团队报告产品" : "请先勾选要应用的产品")
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const json = await post({
        action: "assign",
        text,
        templateId: selectedTemplateId,
        applyAll,
        regenerate: true,
        products: targets.map((p) => ({ product_name: p.product_name, beian_hao: p.beian_hao })),
      })
      setJob(json.job || null)
      setMessage(
        json.job
          ? `已应用到 ${json.updated} 个产品，正在更新最新一周持仓版…`
          : `已应用到 ${json.updated} 个产品`,
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "应用失败")
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const regenerating = job?.status === "running"
  const selectedCount = selectedKeys.size

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <div className="text-sm font-semibold">基金经理观点</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              可选择已有模板或直接输入，应用到全部或单个产品。应用后会更新最新一周持仓版。留空则显示「本周暂无」。
            </div>
          </div>
          <button type="button" className="p-1 rounded hover:bg-muted" onClick={onClose} aria-label="关闭" disabled={regenerating}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyTemplate(null)}
              className={[
                "h-7 px-2.5 rounded-md border text-xs",
                selectedTemplateId == null ? "border-red-200 bg-red-50 text-red-700" : "border-border hover:bg-muted",
              ].join(" ")}
            >
              新输入
            </button>
            {templates.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyTemplate(item)}
                className={[
                  "h-7 px-2.5 rounded-md border text-xs max-w-[10rem] truncate",
                  selectedTemplateId === item.id ? "border-red-200 bg-red-50 text-red-700" : "border-border hover:bg-muted",
                ].join(" ")}
                title={item.name}
              >
                {item.name}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            maxLength={MAX_VIEW_LENGTH}
            onChange={(e) => setText(e.target.value.slice(0, MAX_VIEW_LENGTH))}
            placeholder="写入本周基金经理观点。留空则显示「本周暂无」。"
            className="w-full min-h-[140px] rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value.slice(0, 80))}
              placeholder="模板名称"
              className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              disabled={busy || regenerating}
              onClick={() => void saveTemplate()}
              className="h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted disabled:opacity-50"
            >
              {selectedTemplateId ? "更新模板" : "保存为模板"}
            </button>
            {selectedTemplateId ? (
              <button
                type="button"
                disabled={busy || regenerating}
                onClick={() => void removeTemplate()}
                className="h-8 px-2.5 rounded-md border border-border text-xs text-zinc-500 hover:bg-muted disabled:opacity-50"
              >
                删除模板
              </button>
            ) : null}
            <span className="ml-auto text-[11px] text-muted-foreground">{text.length}/{MAX_VIEW_LENGTH}</span>
          </div>
        </div>

        <div className="px-4 py-3 flex-1 min-h-0 overflow-auto space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索产品名称 / 备案号…"
              className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VOL_BANDS.map((band) => {
              const selected = bandFilter.has(band)
              return (
                <button
                  key={band}
                  type="button"
                  onClick={() => toggleBand(band)}
                  className={[
                    "h-7 px-2.5 rounded-md border text-xs",
                    selected ? "border-red-200 bg-red-50 text-red-700" : "border-border hover:bg-muted",
                  ].join(" ")}
                >
                  {band}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => selectFiltered(true)}>全选当前列表</button>
            <span>·</span>
            <button type="button" className="hover:text-foreground" onClick={() => selectFiltered(false)}>取消全选</button>
            <span className="ml-auto">已选 {selectedCount} · 当前 {filtered.length}</span>
          </div>
          {message ? <div className="text-xs text-sky-600 dark:text-sky-400">{message}</div> : null}
          {job && job.status === "running" ? (
            <div className="text-xs text-muted-foreground">
              正在更新持仓版 {job.done}/{job.total}…
            </div>
          ) : null}
          {loading ? (
            <div className="text-xs text-zinc-400 py-6 text-center">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-zinc-400 py-6 text-center">
              {products.length === 0 ? "暂无团队报告产品" : "没有符合筛选条件的产品"}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((p) => {
                const key = productKey(p)
                const checked = selectedKeys.has(key)
                return (
                  <li key={key}>
                    <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleKey(key)}
                        className="accent-red-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.product_name}</div>
                        <div className="text-[11px] text-zinc-400">{p.beian_hao || "无备案号"}</div>
                      </div>
                      <span className="shrink-0 text-[11px] text-zinc-400">{productVolBand(p)}</span>
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {p.hasView ? "已有观点" : "本周暂无"}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {job?.failed?.length ? (
            <div className="text-xs text-red-600">
              {job.failed.map((item) => (
                <div key={item.product_name}>{item.product_name}：{item.error}</div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy || regenerating}
            onClick={() => void assign(false)}
            className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
          >
            应用到所选产品
          </button>
          <button
            type="button"
            disabled={busy || regenerating}
            onClick={() => void assign(true)}
            className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
          >
            应用到全部
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={regenerating}
            className="h-9 px-3 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
