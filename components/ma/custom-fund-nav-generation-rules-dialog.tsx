"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDays, CirclePlus, MinusCircle } from "lucide-react"
import {
  DEFAULT_SPLICE_FUNDS,
  FUND_SPLICE_CATEGORIES,
  normalizeSpliceFunds,
  type CustomFundNavGenerationRule,
  type FundSpliceEntry,
  type MomLongExtraDate,
  type NavGenRuleType,
} from "@/lib/custom-fund-nav-rules-types"

const RULE_TYPES: { key: NavGenRuleType; label: string }[] = [
  { key: "splice", label: "多基金拼接" },
  { key: "fixed_income", label: "固定收益" },
  { key: "mom_long", label: "计算MOM多头净值" },
]

const NAV_SOURCES = ["平台净值", "团队净值"]

function productSearchUrl(category: string, query: string): string {
  const q = encodeURIComponent(query.trim())
  switch (category) {
    case "自建基金":
      return `/ma/api/custom-funds/list?scope=team&keyword=${q}&pageSize=20`
    case "跟踪产品":
      return `/ma/api/tracking-funds/search?q=${q}`
    case "在管产品":
      return `/ma/api/ops/managed-products/list?keyword=${q}&pageSize=20`
    case "FOF底层":
      return `/ma/api/tracking-fof-underlying/list?keyword=${q}&pageSize=20`
    default:
      return `/ma/api/private-funds/products/search?q=${q}`
  }
}

function parseProductSearchResults(category: string, json: unknown): string[] {
  if (Array.isArray(json)) {
    return json
      .map((item) => (typeof item === "string" ? item : (item as { product_name?: string }).product_name))
      .filter((name): name is string => !!name)
  }
  if (json && typeof json === "object" && Array.isArray((json as { data?: unknown[] }).data)) {
    return (json as { data: { product_name?: string }[] }).data
      .map((row) => row.product_name)
      .filter((name): name is string => !!name)
  }
  void category
  return []
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

function emptyFund(): FundSpliceEntry {
  return {
    fund_category: "私募基金",
    product_name: "",
    nav_source: "平台净值",
    start_date: "",
    end_date: "",
    tail_nav_date: "",
  }
}

function DatePickerInput({
  value,
  onChange,
  placeholder,
  className = "w-44",
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="date"
        lang="zh-CN"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => inputRef.current?.showPicker?.()}
        className={[
          "h-9 w-full rounded border border-border bg-background pl-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
          "[&::-webkit-calendar-picker-indicator]:opacity-0",
          "[&::-webkit-calendar-picker-indicator]:absolute",
          "[&::-webkit-calendar-picker-indicator]:right-2",
          "[&::-webkit-calendar-picker-indicator]:h-full",
          "[&::-webkit-calendar-picker-indicator]:w-8",
          "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
          value ? "text-foreground" : "text-transparent",
        ].join(" ")}
      />
      {!value && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {placeholder}
        </span>
      )}
      <CalendarDays className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

function RuleFormRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-600 shrink-0 w-24 text-right">
        <span className="text-red-500 mr-0.5">*</span>
        {label}：
      </span>
      <div className="flex-1 min-w-0 max-w-md">{children}</div>
    </div>
  )
}

function ProductSearchInput({
  value,
  onChange,
  fundCategory,
}: {
  value: string
  onChange: (value: string) => void
  fundCategory: string
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setOptions([])
      return
    }
    const timer = window.setTimeout(() => {
      fetch(productSearchUrl(fundCategory, query))
        .then((r) => r.json())
        .then((json) => setOptions(parseProductSearchResults(fundCategory, json)))
        .catch(() => setOptions([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, open, fundCategory])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="请搜索并选择产品"
        className="h-9 w-full rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded border bg-background shadow-lg">
          {options.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setQuery(name)
                onChange(name)
                setOpen(false)
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-muted truncate"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FundSpliceRow({
  index,
  row,
  isLast,
  showAdd,
  showRemove,
  onChange,
  onAdd,
  onRemove,
  onAutoStartDate,
  autoStartLoading,
  onAutoHandoff,
  autoHandoffLoading,
}: {
  index: number
  row: FundSpliceEntry
  isLast: boolean
  showAdd: boolean
  showRemove: boolean
  onChange: (next: FundSpliceEntry) => void
  onAdd: () => void
  onRemove: () => void
  onAutoStartDate?: () => void
  autoStartLoading?: boolean
  onAutoHandoff?: () => void
  autoHandoffLoading?: boolean
}) {
  const setDates = (patch: Partial<Pick<FundSpliceEntry, "start_date" | "end_date">>) => {
    const start_date = patch.start_date ?? row.start_date
    const end_date = patch.end_date ?? row.end_date
    onChange({ ...row, start_date, end_date, tail_nav_date: end_date })
  }

  return (
    <div className="rounded border border-zinc-100 bg-zinc-50/40 px-3 py-3 space-y-2.5">
      <div className="grid grid-cols-[4.5rem_7rem_minmax(10rem,1fr)_7rem_2.25rem] gap-x-3 items-center">
        <span className="text-sm text-zinc-600 text-right">
          <span className="text-red-500 mr-0.5">*</span>
          基金{index + 1}：
        </span>
        <select
          value={row.fund_category}
          onChange={(e) => onChange({ ...row, fund_category: e.target.value, product_name: "" })}
          className="h-9 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {FUND_SPLICE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <ProductSearchInput
          fundCategory={row.fund_category}
          value={row.product_name}
          onChange={(product_name) => onChange({ ...row, product_name })}
        />
        <select
          value={row.nav_source}
          onChange={(e) => onChange({ ...row, nav_source: e.target.value })}
          className="h-9 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {NAV_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <div className="flex items-center justify-center">
          {showAdd && (
            <button type="button" onClick={onAdd} className="p-2 rounded hover:bg-muted text-red-500 transition-colors" title="添加基金">
              <CirclePlus className="h-4 w-4" />
            </button>
          )}
          {showRemove && (
            <button type="button" onClick={onRemove} className="p-2 rounded hover:bg-muted text-zinc-500 transition-colors" title="删除基金">
              <MinusCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 items-start">
        <div />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="space-y-1">
            <div className="text-[11px] text-zinc-500">
              <span className="text-red-500 mr-0.5">*</span>
              开始日期
            </div>
            <DatePickerInput
              value={row.start_date}
              onChange={(start_date) => setDates({ start_date })}
              placeholder="开始日期"
              className="w-44"
            />
            {onAutoStartDate && (
              <button
                type="button"
                onClick={onAutoStartDate}
                disabled={autoStartLoading || !row.product_name.trim()}
                className="block text-left text-[11px] text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                {autoStartLoading ? "获取中…" : "填入成立日期"}
              </button>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-zinc-500">
              {!isLast && <span className="text-red-500 mr-0.5">*</span>}
              结束日期{isLast ? "（可选）" : ""}
            </div>
            <DatePickerInput
              value={row.end_date}
              onChange={(end_date) => setDates({ end_date })}
              placeholder={isLast ? "默认最新净值" : "结束日期"}
              className="w-44"
            />
            {onAutoHandoff && (
              <button
                type="button"
                onClick={onAutoHandoff}
                disabled={autoHandoffLoading}
                className="block text-left text-[11px] text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                {autoHandoffLoading ? "计算中…" : "自动对接下一只"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavCalculationRulesHelpDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[640px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">净值计算规则</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm text-zinc-700 leading-relaxed">
          <section>
            <h3 className="font-semibold text-foreground mb-2">* 多基金拼接规则</h3>
            <ol className="list-decimal pl-5 space-y-2">
              <li>拼接日期当日的净值，取第一只A的净值，第二天之后按公式计算；</li>
              <li>n从拼接后第二个净值日期开始，第二只产品B的复权净值比率 * 第一只产品A的复权净值；</li>
              <li>
                新产品AB复权计算公式：
                <span className="font-mono text-[13px] ml-1">AB(n)= AB(n-1)*B(n)/B(n-1)</span>
                ；
              </li>
              <li>使用复权净值进行计算，拼接后的产品ABC，单位=累计=复权。</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold text-foreground mb-2">* 固定收益规则</h3>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                期初净值是P，期末净值
                <span className="font-mono text-[13px] mx-1">Q = P * ( 1+日利率*期初期末日期差 )</span>
                。
              </li>
              <li>日利率=年利率/365</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold text-foreground mb-2">* 计算MOM多头净值规则</h3>
            <p>根据MOM产品股票市值、固定项调整等数据计算产品在多头端的净值表现情况。</p>
          </section>
        </div>
      </div>
    </div>
  )
}

export function CustomFundNavGenerationRulesDialog({
  open,
  productCode,
  onClose,
  onSaved,
}: {
  open: boolean
  productCode: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [ruleType, setRuleType] = useState<NavGenRuleType>("splice")
  const [startDate, setStartDate] = useState("")
  const [annualReturnRate, setAnnualReturnRate] = useState("")
  const [momProductName, setMomProductName] = useState("")
  const [momFixedItem, setMomFixedItem] = useState("")
  const [momNonFixedItem, setMomNonFixedItem] = useState("")
  const [momExtraDates, setMomExtraDates] = useState<MomLongExtraDate[]>([])
  const [funds, setFunds] = useState<FundSpliceEntry[]>(DEFAULT_SPLICE_FUNDS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [tailHint, setTailHint] = useState("")
  const [autoHandoffIndex, setAutoHandoffIndex] = useState<number | null>(null)
  const [autoStartIndex, setAutoStartIndex] = useState<number | null>(null)
  const [showCalcRules, setShowCalcRules] = useState(false)

  useEffect(() => {
    if (!open) return
    setShowCalcRules(false)
    setError("")
    setTailHint("")
    setLoading(true)
    fetch(`/ma/api/custom-funds/nav-rules?code=${encodeURIComponent(productCode)}`, {
      headers: userFetchHeaders(),
    })
      .then((r) => r.json())
      .then((json) => {
        const rule = json.rule as CustomFundNavGenerationRule | undefined
        if (!rule) return
        setRuleType(rule.rule_type ?? "splice")
        setStartDate(rule.start_date ?? "")
        setAnnualReturnRate(rule.annual_return_rate ?? "")
        setMomProductName(rule.mom_product_name ?? "")
        setMomFixedItem(rule.mom_fixed_item ?? "")
        setMomNonFixedItem(rule.mom_non_fixed_item ?? "")
        setMomExtraDates(Array.isArray(rule.mom_extra_dates) ? rule.mom_extra_dates : [])
        const normalized = normalizeSpliceFunds(rule.funds, rule.start_date ?? "")
        setFunds(normalized.length ? normalized : DEFAULT_SPLICE_FUNDS.map((row) => ({ ...row })))
        if (!rule.start_date && normalized[0]?.start_date) {
          setStartDate(normalized[0].start_date)
        }
      })
      .catch(() => setError("加载规则失败"))
      .finally(() => setLoading(false))
  }, [open, productCode])

  function updateFund(index: number, next: FundSpliceEntry) {
    setFunds((prev) => prev.map((row, i) => (i === index ? next : row)))
    if (index === 0 && next.start_date) setStartDate(next.start_date)
    setTailHint("")
  }

  async function handleAutoStartDate(index: number) {
    const fund = funds[index]
    if (!fund?.product_name.trim()) {
      setError(`请先选择基金${index + 1}`)
      return
    }
    setAutoStartIndex(index)
    setError("")
    try {
      const res = await fetch("/ma/api/custom-funds/nav-rules/suggest-start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...userFetchHeaders() },
        body: JSON.stringify({
          code: productCode,
          fund1: fund,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(String(json.message || "获取成立日期失败"))
      }
      const start = String(json.start_date ?? "")
      setFunds((prev) => prev.map((row, i) => (
        i === index ? { ...row, start_date: start } : row
      )))
      if (index === 0) setStartDate(start)
      setTailHint("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取成立日期失败")
    } finally {
      setAutoStartIndex(null)
    }
  }

  async function handleAutoHandoff(index: number) {
    const current = funds[index]
    const next = funds[index + 1]
    if (!current?.product_name.trim() || !next?.product_name.trim()) {
      setError("请先选择当前基金与下一只基金")
      return
    }
    if (!current.start_date.trim()) {
      setError(`请先填写基金${index + 1}的开始日期`)
      return
    }
    setAutoHandoffIndex(index)
    setError("")
    try {
      const res = await fetch("/ma/api/custom-funds/nav-rules/suggest-tail", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...userFetchHeaders() },
        body: JSON.stringify({
          code: productCode,
          start_date: current.start_date,
          fund1: current,
          fund2: next,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(String(json.message || "自动选择失败"))
      }
      const endDate = String(json.end_date ?? json.tail_nav_date ?? "")
      const nextStart = String(json.next_start_date ?? json.fund2_first_date ?? "")
      setFunds((prev) => prev.map((row, i) => {
        if (i === index) {
          return { ...row, end_date: endDate, tail_nav_date: endDate }
        }
        if (i === index + 1) {
          return { ...row, start_date: nextStart || row.start_date }
        }
        return row
      }))
      setTailHint(String(json.hint ?? ""))
    } catch (err) {
      setTailHint("")
      setError(err instanceof Error ? err.message : "自动选择失败")
    } finally {
      setAutoHandoffIndex(null)
    }
  }

  function handleClearRules() {
    setRuleType("splice")
    setStartDate("")
    setAnnualReturnRate("")
    setMomProductName("")
    setMomFixedItem("")
    setMomNonFixedItem("")
    setMomExtraDates([])
    setFunds(DEFAULT_SPLICE_FUNDS.map((row) => ({ ...row })))
    setError("")
  }

  const activeSpliceFunds = funds.filter((f) => f.product_name.trim())
  const spliceDatesReady = activeSpliceFunds.length >= 2
    && activeSpliceFunds.every((f, i) => {
      if (!f.start_date.trim()) return false
      if (i < activeSpliceFunds.length - 1 && !f.end_date.trim()) return false
      return true
    })
  const canSave = !loading && !saving && (
    (ruleType === "splice" && spliceDatesReady)
    || (ruleType === "fixed_income" && !!startDate && !!annualReturnRate.trim())
    || (ruleType === "mom_long" && !!momProductName && !!startDate && !!momFixedItem.trim() && !!momNonFixedItem.trim())
  )

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/ma/api/custom-funds/nav-rules/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...userFetchHeaders() },
        body: JSON.stringify({
          code: productCode,
          action: "save",
          rule: {
            rule_type: ruleType,
            start_date: ruleType === "splice" ? (funds[0]?.start_date || startDate) : startDate,
            annual_return_rate: annualReturnRate,
            mom_product_name: momProductName,
            mom_fixed_item: momFixedItem,
            mom_non_fixed_item: momNonFixedItem,
            mom_extra_dates: momExtraDates,
            funds,
          },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.error === "missing_start_date") throw new Error("请填写第一只基金的开始日期")
        if (json.error === "missing_funds") throw new Error("请至少选择两只基金")
        if (json.error === "missing_fund_dates") throw new Error(String(json.message || "请填写各基金开始/结束日期"))
        if (json.error === "missing_annual_return_rate") throw new Error("请填写年化收益率")
        if (json.error === "missing_mom_product") throw new Error("请选择产品")
        if (json.error === "missing_mom_adjustments") throw new Error("请填写固定项和非固定项")
        if (json.error === "generate_failed") throw new Error(String(json.message || "净值生成失败"))
        throw new Error("保存失败")
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[920px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">净值生成规则</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
          <div className="flex items-center gap-6 flex-wrap">
            {RULE_TYPES.map((item) => (
              <label key={item.key} className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="nav-gen-rule-type"
                  checked={ruleType === item.key}
                  onChange={() => setRuleType(item.key)}
                  className="accent-red-500"
                />
                {item.label}
              </label>
            ))}
          </div>

          {ruleType === "splice" && (
            <>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                请按拼接顺序选择基金，并为每只基金设置开始/结束日期。前一只的结束日期应接在后一只开始之前；可点击「自动对接下一只」自动填入衔接日期。最后一只的结束日期可留空（使用最新净值）。
              </div>

              <div className="space-y-2">
                {loading ? (
                  <p className="text-sm text-muted-foreground">加载中…</p>
                ) : (
                  <div className="space-y-3">
                    {funds.map((row, index) => (
                      <FundSpliceRow
                        key={`fund-row-${index}`}
                        index={index}
                        row={row}
                        isLast={index === funds.length - 1}
                        showAdd={index === 0}
                        showRemove={funds.length > 2 && index === funds.length - 1}
                        onChange={(next) => updateFund(index, next)}
                        onAdd={() => setFunds((prev) => [...prev, emptyFund()])}
                        onRemove={() => setFunds((prev) => prev.slice(0, -1))}
                        onAutoStartDate={() => void handleAutoStartDate(index)}
                        autoStartLoading={autoStartIndex === index}
                        onAutoHandoff={index < funds.length - 1 ? () => void handleAutoHandoff(index) : undefined}
                        autoHandoffLoading={autoHandoffIndex === index}
                      />
                    ))}
                    {tailHint && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">{tailHint}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {ruleType === "fixed_income" && (
            <>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                设置年化收益率，自动生成净值。净值自开始日期开始。
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-600 shrink-0 w-24 text-right">
                    <span className="text-red-500 mr-0.5">*</span>
                    开始时间：
                  </span>
                  <DatePickerInput
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="选择开始时间"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-600 shrink-0 w-24 text-right">
                    <span className="text-red-500 mr-0.5">*</span>
                    年化收益率：
                  </span>
                  <div className="relative w-44">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={annualReturnRate}
                      onChange={(e) => setAnnualReturnRate(e.target.value)}
                      placeholder=""
                      className="h-9 w-full rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">%</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {ruleType === "mom_long" && (
            <>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                根据MOM多头市值与调整项，计算MOM账户多头端净值。
              </div>

              <div className="space-y-4">
                <RuleFormRow label="选择产品">
                  <ProductSearchInput
                    fundCategory="私募基金"
                    value={momProductName}
                    onChange={setMomProductName}
                  />
                </RuleFormRow>
                <RuleFormRow label="开始时间">
                  <DatePickerInput
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="选择开始时间"
                    className="w-full max-w-md"
                  />
                </RuleFormRow>
                <RuleFormRow label="固定项">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={momFixedItem}
                    onChange={(e) => setMomFixedItem(e.target.value)}
                    placeholder="请输入数字"
                    className="h-9 w-full max-w-md rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </RuleFormRow>
                <RuleFormRow label="非固定项">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={momNonFixedItem}
                    onChange={(e) => setMomNonFixedItem(e.target.value)}
                    placeholder="请输入数字"
                    className="h-9 w-full max-w-md rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </RuleFormRow>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMomExtraDates((prev) => [...prev, { date: "", fixed_item: "", non_fixed_item: "" }])}
                  className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors"
                >
                  新增日期
                </button>
              </div>

              {momExtraDates.length > 0 && (
                <div className="border-t border-dashed pt-4 space-y-4">
                  {momExtraDates.map((row, index) => (
                    <div key={`mom-extra-${index}`} className="space-y-3 rounded border border-zinc-100 bg-zinc-50/50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-500">调整日期 {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => setMomExtraDates((prev) => prev.filter((_, i) => i !== index))}
                          className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                      <RuleFormRow label="日期">
                        <DatePickerInput
                          value={row.date}
                          onChange={(date) => setMomExtraDates((prev) => prev.map((item, i) => (i === index ? { ...item, date } : item)))}
                          placeholder="选择日期"
                          className="w-full max-w-md"
                        />
                      </RuleFormRow>
                      <RuleFormRow label="固定项">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.fixed_item}
                          onChange={(e) => setMomExtraDates((prev) => prev.map((item, i) => (i === index ? { ...item, fixed_item: e.target.value } : item)))}
                          placeholder="请输入数字"
                          className="h-9 w-full max-w-md rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </RuleFormRow>
                      <RuleFormRow label="非固定项">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.non_fixed_item}
                          onChange={(e) => setMomExtraDates((prev) => prev.map((item, i) => (i === index ? { ...item, non_fixed_item: e.target.value } : item)))}
                          placeholder="请输入数字"
                          className="h-9 w-full max-w-md rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </RuleFormRow>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t flex-shrink-0">
          <button type="button" onClick={() => setShowCalcRules(true)} className="text-sm text-blue-600 hover:underline">
            净值计算规则
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
            <button
              type="button"
              disabled={saving}
              onClick={handleClearRules}
              className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              清空规则
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void handleSave()}
              className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "处理中…" : "保存并生成净值"}
            </button>
          </div>
        </div>
      </div>
    </div>

    <NavCalculationRulesHelpDialog
      open={showCalcRules}
      onClose={() => setShowCalcRules(false)}
    />
    </>
  )
}
