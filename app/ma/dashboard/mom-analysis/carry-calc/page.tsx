"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, Download, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

// ── types ─────────────────────────────────────────────────────────────────────

interface Account {
  account: string
  cumPnl: number
  cumCommission: number
  cumNetPnl: number
  latestEquity: number | null
  cumDeposit: number
  cumWithdrawal: number
  optionsPnl: number
}

interface Payment {
  id: number
  account: string
  startDate: string | null
  carryDate: string
  operatingDays: number | null
  balance: number | null
  totalProfit: number | null
  profitPortion: number    // 提盈部分 — KEY field for carry deduction
  paidChildCarry: number   // 实付carry
  note: string | null
}

type PaymentDraft = Omit<Payment, "id">

interface InitialData {
  ok: boolean
  latestDate: string | null
  motherRate: number
  childRate: number
  accounts: Account[]
  payments: Payment[]
  notYetRun?: boolean
  error?: string
}

// ── carry computation (pure) ──────────────────────────────────────────────────

interface AccountDetail extends Account {
  settled: number        // sum of profit_portion for this account
  adjustedPnl: number    // cumNetPnl - settled
}

interface CarryResult {
  accountDetails: AccountDetail[]
  totalAdjustedPnl: number
  totalProfit: number
  totalLoss: number
  profitLossRatio: number | null
  profitLossThreshold: number | null
  motherCarry: number
  totalPositiveAdjustedPnl: number
  childCarry: number
  netCarry: number
}

function computeCarry(
  accounts: Account[],
  payments: Payment[],
  motherRate: number,
  childRate: number,
): CarryResult {
  const settledByAccount = new Map<string, number>()
  for (const p of payments) {
    settledByAccount.set(p.account, (settledByAccount.get(p.account) ?? 0) + p.profitPortion)
  }

  const accountDetails: AccountDetail[] = accounts.map((a) => {
    const settled = settledByAccount.get(a.account) ?? 0
    return { ...a, settled, adjustedPnl: a.cumNetPnl - settled }
  })

  const totalAdjustedPnl        = accountDetails.reduce((s, a) => s + a.adjustedPnl, 0)
  const totalProfit              = accountDetails.filter((a) => a.adjustedPnl > 0).reduce((s, a) => s + a.adjustedPnl, 0)
  const totalLoss                = accountDetails.filter((a) => a.adjustedPnl < 0).reduce((s, a) => s + a.adjustedPnl, 0)
  const profitLossRatio          = totalLoss !== 0 ? Math.abs(totalProfit / totalLoss) : null
  // Threshold where netCarry = 0 (motherCarry = childCarry):
  // totalAdjustedPnl * motherRate = totalProfit * childRate  →  R = motherRate / (motherRate - childRate)
  const profitLossThreshold      = motherRate > childRate ? motherRate / (motherRate - childRate) : null
  const motherCarry              = Math.max(0, totalAdjustedPnl) * motherRate
  const totalPositiveAdjustedPnl = totalProfit
  const childCarry               = totalPositiveAdjustedPnl * childRate
  const netCarry                 = motherCarry - childCarry

  return { accountDetails, totalAdjustedPnl, totalProfit, totalLoss, profitLossRatio, profitLossThreshold, motherCarry, totalPositiveAdjustedPnl, childCarry, netCarry }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n)) return "—"
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-muted-foreground"
  if (n > 0) return "text-red-600 dark:text-red-400"
  if (n < 0) return "text-emerald-600 dark:text-emerald-400"
  return ""
}

function pctInput(rate: number): string { return (rate * 100).toFixed(1) }
function parsePct(s: string): number | null {
  const v = parseFloat(s)
  if (isNaN(v) || v < 0 || v > 100) return null
  return v / 100
}

const EMPTY_DRAFT: PaymentDraft = {
  account: "", startDate: "", carryDate: "", operatingDays: null,
  balance: null, totalProfit: null, profitPortion: 0, paidChildCarry: 0, note: "",
}

// ── sub-components ────────────────────────────────────────────────────────────

function RateInput({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <Input
        type="number" min={0} max={100} step={0.1}
        className="h-7 w-20 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-muted-foreground">%</span>
    </label>
  )
}

function PaymentFormRow({
  draft, onChange, onSave, onCancel, saving,
}: {
  draft: PaymentDraft
  onChange: (field: keyof PaymentDraft, val: string) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const field = (k: keyof PaymentDraft) => (draft[k] === null || draft[k] === undefined ? "" : String(draft[k]))
  const set   = (k: keyof PaymentDraft, v: string) => onChange(k, v)
  const inputCls = "h-7 text-xs"
  return (
    <tr className="bg-blue-50/50 dark:bg-blue-950/20">
      <td className="px-2 py-1"><Input className={inputCls} placeholder="账户" value={field("account")} onChange={(e) => set("account", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="date" value={field("startDate")} onChange={(e) => set("startDate", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="date" value={field("carryDate")} onChange={(e) => set("carryDate", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="number" placeholder="运作天数" value={field("operatingDays")} onChange={(e) => set("operatingDays", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="number" placeholder="当日结存" value={field("balance")} onChange={(e) => set("balance", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="number" placeholder="总盈亏" value={field("totalProfit")} onChange={(e) => set("totalProfit", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="number" placeholder="提盈部分*" value={field("profitPortion")} onChange={(e) => set("profitPortion", e.target.value)} /></td>
      <td className="px-2 py-1"><Input className={inputCls} type="number" placeholder="实付carry*" value={field("paidChildCarry")} onChange={(e) => set("paidChildCarry", e.target.value)} /></td>
      <td className="px-2 py-1 text-right space-x-1 whitespace-nowrap">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onSave} disabled={saving} title="保存">
          <Check className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel} title="取消">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </td>
    </tr>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function CarryCalcPage() {
  // ── remote state ──────────────────────────────────────────────────────────
  const [accounts, setAccounts]   = useState<Account[]>([])
  const [payments, setPayments]   = useState<Payment[]>([])
  const [latestDate, setLatestDate] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notYetRun, setNotYetRun] = useState(false)

  // ── rate state ────────────────────────────────────────────────────────────
  const [motherRateStr, setMotherRateStr] = useState("35.0")
  const [childRateStr,  setChildRateStr]  = useState("20.0")
  const [savingRates, setSavingRates]     = useState(false)
  const [ratesSaved, setRatesSaved]       = useState(false)
  const [ratesError, setRatesError]       = useState<string | null>(null)

  // ── payment CRUD state ────────────────────────────────────────────────────
  const [addingPayment, setAddingPayment]     = useState(false)
  const [newDraft, setNewDraft]               = useState<PaymentDraft>(EMPTY_DRAFT)
  const [savingNew, setSavingNew]             = useState(false)
  const [editingId, setEditingId]             = useState<number | null>(null)
  const [editDraft, setEditDraft]             = useState<PaymentDraft>(EMPTY_DRAFT)
  const [savingEdit, setSavingEdit]           = useState(false)
  const [deletingId, setDeletingId]           = useState<number | null>(null)

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const res  = await fetch("/ma/api/mom-analysis/carry")
      const data = (await res.json()) as InitialData
      if (!data.ok) { setLoadError(data.error ?? "加载失败"); return }
      if (data.notYetRun) { setNotYetRun(true); return }
      setAccounts(data.accounts ?? [])
      setPayments(data.payments ?? [])
      setLatestDate(data.latestDate ?? null)
      setMotherRateStr(pctInput(data.motherRate))
      setChildRateStr(pctInput(data.childRate))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // ── derived carry ─────────────────────────────────────────────────────────
  const motherRate = useMemo(() => parsePct(motherRateStr) ?? 0.35, [motherRateStr])
  const childRate  = useMemo(() => parsePct(childRateStr)  ?? 0.20, [childRateStr])
  const carry      = useMemo(
    () => computeCarry(accounts, payments, motherRate, childRate),
    [accounts, payments, motherRate, childRate],
  )

  // ── save rates ────────────────────────────────────────────────────────────
  const saveRates = async () => {
    const mr = parsePct(motherRateStr)
    const cr = parsePct(childRateStr)
    if (mr === null) { setRatesError("母层报酬率格式错误（0–100）"); return }
    if (cr === null) { setRatesError("子层报酬率格式错误（0–100）"); return }
    setSavingRates(true); setRatesError(null)
    try {
      const res = await fetch("/ma/api/mom-analysis/carry-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motherRate: mr, childRate: cr }),
      })
      if (!res.ok) throw new Error("保存失败")
      setRatesSaved(true); setTimeout(() => setRatesSaved(false), 2000)
    } catch (e) {
      setRatesError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSavingRates(false)
    }
  }

  // ── draft helpers ─────────────────────────────────────────────────────────
  const applyDraftChange = (draft: PaymentDraft, field: keyof PaymentDraft, val: string): PaymentDraft => {
    const numFields: (keyof PaymentDraft)[] = ["operatingDays", "balance", "totalProfit", "profitPortion", "paidChildCarry"]
    if (numFields.includes(field)) {
      return { ...draft, [field]: val === "" ? null : Number(val) }
    }
    return { ...draft, [field]: val === "" ? null : val }
  }

  // ── add payment ───────────────────────────────────────────────────────────
  const saveNew = async () => {
    if (!newDraft.account || !newDraft.carryDate) return
    setSavingNew(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/carry-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDraft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "保存失败")
      setPayments((prev) => [...prev, json.record as Payment])
      setNewDraft(EMPTY_DRAFT); setAddingPayment(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSavingNew(false)
    }
  }

  // ── edit payment ──────────────────────────────────────────────────────────
  const startEdit = (p: Payment) => {
    setEditingId(p.id)
    const { id: _id, ...rest } = p
    setEditDraft(rest)
  }

  const saveEdit = async () => {
    if (editingId === null) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/ma/api/mom-analysis/carry-payments/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "保存失败")
      setPayments((prev) => prev.map((p) => (p.id === editingId ? (json.record as Payment) : p)))
      setEditingId(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSavingEdit(false)
    }
  }

  // ── delete payment ────────────────────────────────────────────────────────
  const deletePayment = async (id: number) => {
    if (!confirm("确认删除此条已付记录？")) return
    setDeletingId(id)
    try {
      const res = await fetch(`/ma/api/mom-analysis/carry-payments/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("删除失败")
      setPayments((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  const colHeaders = ["账户", "起始日", "提盈日", "运作天数", "当日结存", "总盈亏", "提盈部分", "实付carry", ""]

  return (
    <div className="space-y-6 pt-6">
      {/* header */}
      <div className="flex items-center gap-3">
        <Link href="/ma/dashboard/mom-analysis">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">业绩报酬测算</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            截至最新交易日{latestDate ? <span className="font-medium text-foreground">（{latestDate}）</span> : ""}
          </p>
        </div>
      </div>

      {loading   && <p className="text-sm text-muted-foreground py-4">加载中…</p>}
      {!loading && loadError   && <p className="text-sm text-destructive">{loadError}</p>}
      {!loading && notYetRun && <p className="text-sm text-muted-foreground">暂无数据，请先完成数据导入。</p>}

      {!loading && !loadError && !notYetRun && (
        <>
          {/* ── rates editor ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">报酬率设置</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <RateInput label="母层报酬率" value={motherRateStr} onChange={(v) => { setMotherRateStr(v); setRatesSaved(false) }} />
                <RateInput label="子层报酬率" value={childRateStr}  onChange={(v) => { setChildRateStr(v);  setRatesSaved(false) }} />
                <Button size="sm" className="h-8" onClick={saveRates} disabled={savingRates}>
                  {ratesSaved ? <><Check className="h-3.5 w-3.5 mr-1" />已保存</> : "保存"}
                </Button>
                {ratesError && <span className="text-xs text-destructive">{ratesError}</span>}
              </div>
            </CardContent>
          </Card>

          {/* ── payments CRUD ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">历史已付业绩报酬记录</CardTitle>
              <Button
                size="sm" variant="outline" className="h-7 gap-1 text-xs"
                onClick={() => { setAddingPayment(true); setNewDraft(EMPTY_DRAFT) }}
                disabled={addingPayment}
              >
                <Plus className="h-3.5 w-3.5" />添加
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      {colHeaders.map((h, i) => (
                        <th key={i} className={`px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap ${i > 0 && i < colHeaders.length - 1 ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {addingPayment && (
                      <PaymentFormRow
                        draft={newDraft}
                        onChange={(f, v) => setNewDraft((d) => applyDraftChange(d, f, v))}
                        onSave={saveNew}
                        onCancel={() => setAddingPayment(false)}
                        saving={savingNew}
                      />
                    )}
                    {payments.map((p) =>
                      editingId === p.id ? (
                        <PaymentFormRow
                          key={p.id}
                          draft={editDraft}
                          onChange={(f, v) => setEditDraft((d) => applyDraftChange(d, f, v))}
                          onSave={saveEdit}
                          onCancel={() => setEditingId(null)}
                          saving={savingEdit}
                        />
                      ) : (
                        <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-mono text-xs">{p.account}</td>
                          <td className="px-3 py-2 text-xs text-right text-muted-foreground">{p.startDate ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-right text-muted-foreground">{p.carryDate}</td>
                          <td className="px-3 py-2 text-right text-xs">{p.operatingDays ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs">{fmt(p.balance)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs">{fmt(p.totalProfit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(p.profitPortion)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-orange-600 dark:text-orange-400">{fmt(p.paidChildCarry)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(p)} title="编辑">
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deletePayment(p.id)} disabled={deletingId === p.id} title="删除">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      )
                    )}
                    {payments.length === 0 && !addingPayment && (
                      <tr><td colSpan={9} className="px-3 py-4 text-center text-xs text-muted-foreground">暂无记录</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── account breakdown ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">各账户调整后盈亏</CardTitle>
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                onClick={() => {
                  const headers = ["账户","最新客户权益","累计期货盈亏","累计手续费","累计期权盈亏","累计净盈亏","累计存入","累计取出","已计提盈","调整后盈亏","计入子层"]
                  const rows = carry.accountDetails.map((a) => [
                    a.account,
                    a.latestEquity ?? "",
                    a.cumPnl,
                    a.cumCommission,
                    a.optionsPnl || "",
                    a.cumNetPnl,
                    a.cumDeposit || "",
                    a.cumWithdrawal || "",
                    a.settled > 0 ? -a.settled : "",
                    a.adjustedPnl,
                    a.adjustedPnl > 0 ? "✓" : "",
                  ])
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
                  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url; a.download = `各账户调整后盈亏_${latestDate ?? ""}.csv`; a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <Download className="h-3.5 w-3.5" />下载
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-hidden rounded-b-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">账户</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">最新客户权益</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计期货盈亏</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计手续费</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计期权盈亏</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计净盈亏</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计存入</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">累计取出</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">已计提盈</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">调整后盈亏</th>
                      <th className="px-4 py-2 text-center font-medium text-muted-foreground">计入子层</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {carry.accountDetails.map((a) => (
                      <tr key={a.account} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{a.account}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(a.latestEquity)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${pnlClass(a.cumPnl)}`}>{fmt(a.cumPnl)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-muted-foreground">{fmt(a.cumCommission)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums text-xs ${a.optionsPnl ? pnlClass(a.optionsPnl) : "text-muted-foreground"}`}>{a.optionsPnl ? fmt(a.optionsPnl) : "\u2014"}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${pnlClass(a.cumNetPnl)}`}>{fmt(a.cumNetPnl)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-muted-foreground">{a.cumDeposit ? fmt(a.cumDeposit) : "\u2014"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-muted-foreground">{a.cumWithdrawal ? fmt(a.cumWithdrawal) : "\u2014"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-muted-foreground">
                          {a.settled > 0 ? `−${fmt(a.settled)}` : "—"}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${pnlClass(a.adjustedPnl)}`}>{fmt(a.adjustedPnl)}</td>
                        <td className="px-4 py-2 text-center">
                          {a.adjustedPnl > 0
                            ? <span className="text-red-600 dark:text-red-400 font-medium">✓</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── carry result ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">计算结果</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新
              </Button>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="divide-y divide-border text-sm">
                {/* 盈亏统计 */}
                <div className="pb-3 space-y-1">
                  <p className="font-medium">盈亏统计（调整后盈亏）</p>
                  <div className="grid grid-cols-3 gap-x-4 text-xs font-mono">
                    <div>
                      <span className="text-muted-foreground">总盈利&nbsp;</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">{fmt(carry.totalProfit)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">总亏损&nbsp;</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(carry.totalLoss)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">盈亏比&nbsp;</span>
                      <span className={`font-semibold ${
                        carry.profitLossRatio !== null && carry.profitLossThreshold !== null
                          ? carry.profitLossRatio >= carry.profitLossThreshold
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400"
                          : ""
                      }`}>
                        {carry.profitLossRatio !== null ? carry.profitLossRatio.toFixed(2) : "—"}
                      </span>
                    </div>
                  </div>
                  {carry.profitLossThreshold !== null && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      盈亏比盈亏平衡阈值&nbsp;
                      <span className="font-semibold text-foreground">{carry.profitLossThreshold.toFixed(2)}</span>
                      &nbsp;（母层{(motherRate * 100).toFixed(1)}%&nbsp;÷&nbsp;净差{((motherRate - childRate) * 100).toFixed(1)}%）
                      &nbsp;—&nbsp;
                      {carry.profitLossRatio !== null
                        ? carry.profitLossRatio >= carry.profitLossThreshold
                          ? <span className="text-red-600 dark:text-red-400">当前高于阈值，净carry为正 ✓</span>
                          : <span className="text-emerald-600 dark:text-emerald-400">当前低于阈值，净carry为负 ✗</span>
                        : "暂无亏损账户"}
                    </p>
                  )}
                </div>
                {/* 母层 */}
                <div className="pb-3 space-y-1">
                  <p className="font-medium">母层业绩报酬</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    调整后总盈亏&nbsp;{fmt(carry.totalAdjustedPnl)}&nbsp;×&nbsp;{(motherRate * 100).toFixed(1)}%&nbsp;=&nbsp;
                    <span className={`font-semibold ${pnlClass(carry.motherCarry)}`}>{fmt(carry.motherCarry)}</span>
                  </p>
                </div>
                {/* 子层 */}
                <div className="py-3 space-y-1">
                  <p className="font-medium">子层业绩报酬（盈利账户）</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    盈利账户调整后总盈亏&nbsp;{fmt(carry.totalPositiveAdjustedPnl)}&nbsp;
                    （共&nbsp;{carry.accountDetails.filter((a) => a.adjustedPnl > 0).length}&nbsp;个）&nbsp;
                    ×&nbsp;{(childRate * 100).toFixed(1)}%&nbsp;=&nbsp;
                    <span className={`font-semibold ${pnlClass(carry.childCarry)}`}>{fmt(carry.childCarry)}</span>
                  </p>
                </div>
                {/* net */}
                <div className="pt-3 space-y-1 bg-muted/20 rounded px-3 -mx-3">
                  <p className="font-medium">净业绩报酬</p>
                  <p className="text-xs font-mono">
                    <span className="text-muted-foreground">
                      母层&nbsp;{fmt(carry.motherCarry)}&nbsp;−&nbsp;子层&nbsp;{fmt(carry.childCarry)}&nbsp;=&nbsp;
                    </span>
                    <span className={`text-base font-bold ${pnlClass(carry.netCarry)}`}>{fmt(carry.netCarry)}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
