"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPct, formatRatioPct, formatYuan, type AccountLayerAction, type BreachRow, type CutRow, type HolderRow } from "@/lib/ma/var-mcr-policy"

const API_URL = "/ma/api/mom-analysis/var-mcr-suggestions?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

type SuggestionPayload = {
  ok: boolean
  date?: string
  latestDate?: string
  selectedDate?: string
  conclusion?: string
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  varPct?: number | null
  var95?: number | null
  cumCapital?: number | null
  capOk?: boolean
  driver?: { driver: string; dVar: number | null; attrPos: number | null; attrMkt: number | null }
  budgetSoft?: string | null
  budgetHard?: string | null
  budgetHardStreak?: number
  breaches?: BreachRow[]
  approaching?: { products: Array<{ name: string; label: string; sharePct: number }>; sectors: Array<{ name: string; label: string; sharePct: number }> }
  objects?: Array<{
    kind: "product" | "sector"
    name: string
    label: string
    breach: BreachRow
    holders: HolderRow[]
    holderSort: "gross" | "absNet"
    nnrScope: string
    k: number
    kMethod: "bisection" | "linear"
    achievedShare: number | null
    targetPct: number
    formalCut: boolean
    cuts: CutRow[]
    residualCuts: CutRow[]
    cutNote: string
  }>
  accountActions?: AccountLayerAction[]
  dataGaps?: {
    positionsWithoutAdvisor: string[]
    equityWithoutRoster: string[]
    rosterWithoutEquity: string[]
    missingWarningLines: string[]
  }
  cacheStatus?: string
  error?: string
}

function stanceClass(stance: string): string {
  if (stance === "建议减仓") return "bg-red-100 text-red-800 border-red-200"
  if (stance === "禁止新增") return "bg-amber-100 text-amber-800 border-amber-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

function actionClass(action: string | null): string {
  if (action === "上报投资经理") return "bg-red-100 text-red-800 border-red-200"
  if (action === "限制该账户新增") return "bg-amber-100 text-amber-800 border-amber-200"
  return "bg-slate-100 text-slate-700 border-slate-200"
}

function dayText(days: number | null | undefined, capped = false): string {
  if (days == null) return "—"
  if (capped) return `≥${days} 天`
  if (days <= 0) return "当日"
  return `${days} 天`
}

function holdOverdue(row: HolderRow): boolean {
  const hold = row.hold
  if (!hold || hold.typicalDays == null) return false
  const age = hold.lotAgeDays ?? hold.holdDays
  if (age == null) return false
  return age > hold.typicalDays * 1.5 && age >= hold.typicalDays + 3
}

function holdTitle(row: HolderRow): string {
  const hold = row.hold
  if (!hold || hold.holdDays == null || !hold.holdSince) return "没有查到这段连续持仓。"
  const mode = hold.holdMode === "gross"
    ? "多空同时持有，从最近一次清空之后重新计算"
    : "当前方向连续持有，中途换月不重新计算"
  const age = hold.lotAgeDays == null
    ? ""
    : `未平仓手数加权开仓 ${dayText(hold.lotAgeDays)}。`
  const oldest = hold.oldestLotDate ? `最早一手开于 ${hold.oldestLotDate}。` : ""
  const cap = hold.holdCapped ? "账本起始日之前的持仓看不到，所以这是下限。" : ""
  const late = holdOverdue(row) ? "未平仓手数的加权开仓天数已长于该交易员的惯用持仓。" : ""
  return `${mode}，自 ${hold.holdSince}。${age}${oldest}${cap}${late}`
}

function typicalTitle(row: HolderRow): string {
  const hold = row.hold
  if (!hold || hold.typicalDays == null) return "平仓样本不足，没有惯用持仓天数。"
  const product = hold.productTypicalN > 0 ? `本品种中位 ${dayText(hold.productTypicalDays)}（${hold.productTypicalN} 笔平仓）。` : "本品种平仓样本不足。"
  const account = hold.accountTypicalN > 0 ? `该账户全部品种中位 ${dayText(hold.accountTypicalDays)}（${hold.accountTypicalN} 笔平仓）。` : ""
  const used = hold.typicalScope === "product" ? "表内用本品种。" : "表内用全部品种，因为本品种样本少于 8 笔。"
  return `${product}${account}${used}天数是平仓日减开仓日，按手数加权取中位。`
}

function floatPnlCell(value: number | null | undefined): { text: string; className: string } {
  if (value == null || !Number.isFinite(value)) return { text: "—", className: "text-muted-foreground" }
  if (Math.abs(value) < 1) return { text: "平", className: "text-muted-foreground" }
  return {
    text: `${value > 0 ? "盈" : "亏"} ${formatYuan(Math.abs(value))}`,
    className: value > 0 ? "text-orange-600" : "text-teal-700",
  }
}

function holderBarOption(label: string, holders: HolderRow[]) {
  const byAccount = new Map<string, { name: string; gross: number; net: number }>()
  for (const row of holders) {
    const cur = byAccount.get(row.account) ?? { name: row.displayName, gross: 0, net: 0 }
    cur.gross += row.grossMv
    cur.net += row.netMv
    byAccount.set(row.account, cur)
  }
  const rows = [...byAccount.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.gross - a.gross).slice(0, 12)
  if (rows.length === 0) return null
  return {
    title: { text: `${label}账户贡献`, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: "#1f2937" } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ seriesName: string; value: number; marker: string; name: string }>) => {
        const lines = params.map((p) => `${p.marker}${p.seriesName}: ${formatYuan(Number(p.value))}`)
        return [params[0]?.name, ...lines].join("<br/>")
      },
    },
    legend: { data: ["净市值", "总市值（绝对值合计）"], top: 18, textStyle: { fontSize: 10 } },
    grid: { left: 120, right: 24, top: 42, bottom: 16 },
    xAxis: { type: "value", axisLabel: { fontSize: 9, formatter: (v: number) => `${Math.round(v / 10000)}万` }, splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } } },
    yAxis: { type: "category", data: rows.map((r) => r.name).reverse(), axisLabel: { fontSize: 10 } },
    series: [
      { name: "净市值", type: "bar", data: rows.map((r) => r.net).reverse(), itemStyle: { color: "#1A365D" }, barMaxWidth: 14 },
      { name: "总市值（绝对值合计）", type: "bar", data: rows.map((r) => r.gross).reverse(), itemStyle: { color: "#C9A227" }, barMaxWidth: 14 },
    ],
  }
}

type HolderAccountGroup = {
  account: string
  displayName: string
  netMv: number
  grossMv: number
  netLots: number
  shareOfObject: number
  shareOfAccount: number
  floatPnl: number | null
  maxHoldDays: number | null
  maxHoldCapped: boolean
  overdue: boolean
  products: HolderRow[]
}

function groupHoldersByAccount(holders: HolderRow[], holderSort: "gross" | "absNet"): HolderAccountGroup[] {
  const byAccount = new Map<string, HolderAccountGroup>()
  for (const row of holders) {
    const cur = byAccount.get(row.account)
    if (!cur) {
      byAccount.set(row.account, {
        account: row.account,
        displayName: row.displayName,
        netMv: row.netMv,
        grossMv: row.grossMv,
        netLots: row.netLots,
        shareOfObject: row.shareOfObject,
        shareOfAccount: row.shareOfAccount,
        floatPnl: row.hold?.floatPnl ?? null,
        maxHoldDays: row.hold?.holdDays ?? null,
        maxHoldCapped: Boolean(row.hold?.holdCapped),
        overdue: holdOverdue(row),
        products: [row],
      })
      continue
    }
    cur.netMv += row.netMv
    cur.grossMv += row.grossMv
    cur.netLots += row.netLots
    cur.shareOfObject += row.shareOfObject
    cur.shareOfAccount += row.shareOfAccount
    const pnl = row.hold?.floatPnl
    if (pnl != null && Number.isFinite(pnl)) {
      cur.floatPnl = (cur.floatPnl ?? 0) + pnl
    }
    const holdDays = row.hold?.holdDays
    if (holdDays != null && (cur.maxHoldDays == null || holdDays > cur.maxHoldDays)) {
      cur.maxHoldDays = holdDays
      cur.maxHoldCapped = Boolean(row.hold?.holdCapped)
    } else if (holdDays != null && holdDays === cur.maxHoldDays && row.hold?.holdCapped) {
      cur.maxHoldCapped = true
    }
    if (holdOverdue(row)) cur.overdue = true
    cur.products.push(row)
  }
  const groups = [...byAccount.values()]
  for (const group of groups) {
    group.products.sort((a, b) => {
      const wa = holderSort === "gross" ? a.grossMv : Math.abs(a.netMv)
      const wb = holderSort === "gross" ? b.grossMv : Math.abs(b.netMv)
      return wb - wa
    })
  }
  groups.sort((a, b) => {
    const wa = holderSort === "gross" ? a.grossMv : Math.abs(a.netMv)
    const wb = holderSort === "gross" ? b.grossMv : Math.abs(b.netMv)
    return wb - wa
  })
  return groups
}

function productSummary(products: Array<{ prod: string; prodLabel: string }>): string {
  if (products.length === 1) return products[0].prodLabel
  const codes = products.map((row) => row.prod)
  if (codes.length <= 4) return `${products.length} 个：${codes.join("、")}`
  return `${products.length} 个：${codes.slice(0, 3).join("、")}…`
}

function HolderProductCells({ row }: { row: HolderRow }) {
  const pnl = floatPnlCell(row.hold?.floatPnl)
  return (
    <>
      <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.netMv)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.grossMv)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{row.netLots.toLocaleString("zh-CN")}</td>
      <td className={`px-2 py-1.5 text-right ${holdOverdue(row) ? "text-amber-700" : ""}`} title={holdTitle(row)}>
        <div className="font-mono">{dayText(row.hold?.holdDays, row.hold?.holdCapped)}</div>
        {row.hold?.holdSince && (
          <div className="text-[10px] text-muted-foreground">
            自 {row.hold.holdSince.slice(5)}
            {row.hold.lotAgeDays != null && Math.abs(row.hold.lotAgeDays - (row.hold.holdDays ?? 0)) >= 3
              ? ` · 手数 ${dayText(row.hold.lotAgeDays)}`
              : ""}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-right" title={typicalTitle(row)}>
        <div className="font-mono">{dayText(row.hold?.typicalDays)}</div>
        {row.hold?.typicalScope && (
          <div className="text-[10px] text-muted-foreground">
            {row.hold.typicalScope === "product" ? "本品种" : "全账户"} · {row.hold.typicalN} 笔
          </div>
        )}
      </td>
      <td className={`px-2 py-1.5 text-right font-mono ${pnl.className}`} title="开仓价到今结算价，按未平仓手数重估。">{pnl.text}</td>
      <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.shareOfObject * 100)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.shareOfAccount * 100)}</td>
    </>
  )
}

function HoldersTable({ holders, holderSort }: { holders: HolderRow[]; holderSort: "gross" | "absNet" }) {
  const groups = useMemo(() => groupHoldersByAccount(holders, holderSort), [holders, holderSort])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((account: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }, [])

  if (groups.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={10} className="px-2 py-2 text-muted-foreground">当日没有查到该对象的账户持仓。</td>
        </tr>
      </tbody>
    )
  }

  return (
    <>
      {groups.map((group) => {
        const open = expanded.has(group.account)
        const pnl = floatPnlCell(group.floatPnl)
        const canExpand = group.products.length > 1
        return (
          <tbody key={group.account} className="border-b last:border-0">
            <tr
              className={canExpand ? "cursor-pointer hover:bg-muted/40" : undefined}
              onClick={canExpand ? () => toggle(group.account) : undefined}
              aria-expanded={canExpand ? open : undefined}
            >
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-1">
                  {canExpand ? (
                    open
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="inline-block w-3.5 shrink-0" />
                  )}
                  <span>{group.displayName}</span>
                </div>
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{productSummary(group.products)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatYuan(group.netMv)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatYuan(group.grossMv)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{group.netLots.toLocaleString("zh-CN")}</td>
              <td className={`px-2 py-1.5 text-right ${group.overdue ? "text-amber-700" : ""}`} title={canExpand ? "最长连续持有天数；点开看各品种明细。" : undefined}>
                <div className="font-mono">{dayText(group.maxHoldDays, group.maxHoldCapped)}</div>
                {canExpand && <div className="text-[10px] text-muted-foreground">最长</div>}
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{canExpand ? "—" : (
                <div>
                  <div className="font-mono text-foreground">{dayText(group.products[0]?.hold?.typicalDays)}</div>
                  {group.products[0]?.hold?.typicalScope && (
                    <div className="text-[10px]">
                      {group.products[0].hold.typicalScope === "product" ? "本品种" : "全账户"} · {group.products[0].hold.typicalN} 笔
                    </div>
                  )}
                </div>
              )}</td>
              <td className={`px-2 py-1.5 text-right font-mono ${pnl.className}`}>{pnl.text}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatPct(group.shareOfObject * 100)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatPct(group.shareOfAccount * 100)}</td>
            </tr>
            {open && group.products.map((row) => (
              <tr key={`${row.account}-${row.prod}`} className="bg-muted/20">
                <td className="px-2 py-1.5 pl-7 text-muted-foreground" />
                <td className="px-2 py-1.5">{row.prodLabel}</td>
                <HolderProductCells row={row} />
              </tr>
            ))}
          </tbody>
        )
      })}
    </>
  )
}

function directionText(direction: CutRow["direction"] | "mixed"): string {
  if (direction === "short") return "空头（回补）"
  if (direction === "long") return "多头（减多）"
  if (direction === "mixed") return "多空"
  return "平"
}

function careText(note: string | undefined): string {
  return note ? note : "按市值"
}

function careClass(note: string): string {
  if (note === "浮亏且持有长于惯用") return "text-amber-700"
  if (note === "当日开仓") return "text-sky-800"
  return "text-muted-foreground"
}

function groupCareText(products: CutRow[]): string {
  const notes = [...new Set(products.map((row) => careText(row.careNote)))]
  if (notes.length === 1) return notes[0]
  return "见各品种"
}

type CutAccountGroup = {
  account: string
  displayName: string
  currentMv: number
  targetMv: number
  cutAbsMv: number
  currentLots: number
  targetLots: number
  cutLots: number
  direction: CutRow["direction"] | "mixed"
  products: CutRow[]
}

function groupCutsByAccount(cuts: CutRow[]): CutAccountGroup[] {
  const byAccount = new Map<string, CutAccountGroup>()
  for (const row of cuts) {
    const cur = byAccount.get(row.account)
    if (!cur) {
      byAccount.set(row.account, {
        account: row.account,
        displayName: row.displayName,
        currentMv: row.currentMv,
        targetMv: row.targetMv,
        cutAbsMv: row.cutAbsMv,
        currentLots: row.currentLots,
        targetLots: row.targetLots,
        cutLots: row.cutLots,
        direction: row.direction,
        products: [row],
      })
      continue
    }
    cur.currentMv += row.currentMv
    cur.targetMv += row.targetMv
    cur.cutAbsMv += row.cutAbsMv
    cur.currentLots += row.currentLots
    cur.targetLots += row.targetLots
    cur.cutLots += row.cutLots
    if (cur.direction !== row.direction) cur.direction = "mixed"
    cur.products.push(row)
  }
  const groups = [...byAccount.values()]
  for (const group of groups) {
    group.products.sort((a, b) => b.cutAbsMv - a.cutAbsMv)
  }
  groups.sort((a, b) => b.cutAbsMv - a.cutAbsMv)
  return groups
}

function CutsTable({ cuts }: { cuts: CutRow[] }) {
  const groups = useMemo(() => groupCutsByAccount(cuts), [cuts])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((account: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }, [])

  if (groups.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={10} className="px-2 py-2 text-muted-foreground">没有需要分摊的主要账户。</td>
        </tr>
      </tbody>
    )
  }

  return (
    <>
      {groups.map((group) => {
        const open = expanded.has(group.account)
        const canExpand = group.products.length > 1
        return (
          <tbody key={group.account} className="border-b last:border-0">
            <tr
              className={canExpand ? "cursor-pointer hover:bg-muted/40" : undefined}
              onClick={canExpand ? () => toggle(group.account) : undefined}
              aria-expanded={canExpand ? open : undefined}
            >
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-1">
                  {canExpand ? (
                    open
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="inline-block w-3.5 shrink-0" />
                  )}
                  <span>{group.displayName}</span>
                </div>
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{productSummary(group.products)}</td>
              <td className="px-2 py-1.5">{directionText(group.direction)}</td>
              <td className={`px-2 py-1.5 ${careClass(groupCareText(group.products))}`}>{groupCareText(group.products)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatYuan(group.currentMv)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatYuan(group.targetMv)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{formatYuan(group.cutAbsMv)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{group.currentLots.toLocaleString("zh-CN")}</td>
              <td className="px-2 py-1.5 text-right font-mono">{group.targetLots.toLocaleString("zh-CN")}</td>
              <td className="px-2 py-1.5 text-right font-mono">{group.cutLots.toLocaleString("zh-CN")}</td>
            </tr>
            {open && group.products.map((row) => (
              <tr key={`${row.account}-${row.prod}`} className="bg-muted/20">
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5">{row.prodLabel}</td>
                <td className="px-2 py-1.5">{directionText(row.direction)}</td>
                <td className={`px-2 py-1.5 ${careClass(careText(row.careNote))}`}>{careText(row.careNote)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.currentMv)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.targetMv)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatYuan(row.cutAbsMv)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{row.currentLots.toLocaleString("zh-CN")}</td>
                <td className="px-2 py-1.5 text-right font-mono">{row.targetLots.toLocaleString("zh-CN")}</td>
                <td className="px-2 py-1.5 text-right font-mono">{row.cutLots.toLocaleString("zh-CN")}</td>
              </tr>
            ))}
          </tbody>
        )
      })}
    </>
  )
}

export default function VarMcrSuggestionsPanel() {
  const [data, setData] = useState<SuggestionPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(API_URL, { cache: "no-cache" })
      const json = (await resp.json()) as SuggestionPayload
      if (!json?.ok) {
        setError(json?.error || "加载失败")
        return
      }
      // Account-risk catch-all answers `{ ok: true }` with no suggestion body.
      if (typeof json.conclusion !== "string") {
        setError(null)
        setData(null)
        return
      }
      setError(null)
      setData(json)
      const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
      if (stale) {
        if (staleTimer.current) clearTimeout(staleTimer.current)
        staleTimer.current = setTimeout(() => { void load() }, STALE_RETRY_MS)
      }
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVis)
    const poll = setInterval(() => { void load() }, POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(poll)
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [load])

  const objects = data?.objects ?? []
  const breaches = data?.breaches ?? []
  const accountActions = data?.accountActions ?? []
  const approaching = data?.approaching

  const gapNotes = useMemo(() => {
    const gaps = data?.dataGaps
    if (!gaps) return []
    const names = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
    const positionsWithoutAdvisor = names(gaps.positionsWithoutAdvisor)
    const missingWarningLines = names(gaps.missingWarningLines)
    const equityWithoutRoster = names(gaps.equityWithoutRoster)
    const notes: string[] = []
    if (positionsWithoutAdvisor.length) notes.push(`持仓账户未在投顾对照表中找到姓名：${positionsWithoutAdvisor.join("、")}。`)
    if (missingWarningLines.length) notes.push(`下列在场账户对照表中没有解析到预警/止损线：${missingWarningLines.join("、")}。`)
    if (equityWithoutRoster.length) notes.push(`有结算权益但不在当前对照表：${equityWithoutRoster.join("、")}。`)
    return notes
  }, [data])

  if (loading && !data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">处置建议加载中...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section id="section-intraday-mcr-suggestions" className="mt-4">
        <p className="text-sm text-muted-foreground">暂无处置建议</p>
      </section>
    )
  }

  return (
    <section id="section-intraday-mcr-suggestions" className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            当日处置建议
            <span className="text-xs font-normal text-muted-foreground">{data.selectedDate}{data.selectedDate !== data.latestDate ? `（最新日 ${data.latestDate}）` : ""}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
            {data.conclusion}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {data.varPct != null && <span>VaR/资本 {formatPct(data.varPct, 2)}</span>}
            {data.var95 != null && <span>1日95%VaR {formatYuan(data.var95)}</span>}
            {data.cumCapital != null && <span>累计净资本 {formatYuan(data.cumCapital)}</span>}
            {data.driver?.driver && data.driver.driver !== "na" && (
              <span>VaR变化主因：{data.driver.driver === "position" ? "持仓" : data.driver.driver === "market" ? "市场" : "变化很小"}</span>
            )}
          </div>
          {breaches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">对象</th>
                    <th className="px-2 py-1.5 text-right font-medium">贡献</th>
                    <th className="px-2 py-1.5 text-right font-medium">软/硬线</th>
                    <th className="px-2 py-1.5 text-right font-medium">软线连续</th>
                    <th className="px-2 py-1.5 text-right font-medium">硬线连续</th>
                    <th className="px-2 py-1.5 text-left font-medium">建议立场</th>
                    <th className="px-2 py-1.5 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((row) => (
                    <tr key={`${row.kind}-${row.name}`} className="border-b last:border-0">
                      <td className="px-2 py-1.5">{row.label}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatPct(row.sharePct)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.softPct}% / {row.hardPct}%</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.softStreak} 日</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.hardStreak} 日</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={stanceClass(row.stance)}>{row.stance}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {row.formalCut ? "正式硬砍" : row.frozenHard ? "硬阈值冻结" : row.nnrAlreadyInEffect ? "禁止新增已生效" : "次日起禁止新增"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              最新日无品种/板块软预警突破。
              {approaching?.products?.length || approaching?.sectors?.length
                ? `接近软线（2 个百分点以内）的有：${[...(approaching?.products ?? []), ...(approaching?.sectors ?? [])].map((row) => `${row.label} ${formatPct(row.sharePct)}`).join("、")}。`
                : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {objects.map((obj) => {
        const option = holderBarOption(obj.label, obj.holders)
        return (
          <Card key={`${obj.kind}-${obj.name}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {obj.label}：持仓账户与处置
                <Badge variant="outline" className={stanceClass(obj.breach.stance)}>{obj.breach.stance}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-xs leading-6 text-foreground">{obj.nnrScope}</p>
              {option && <ReactECharts option={option} style={{ height: Math.max(160, Math.min(320, obj.holders.length * 28 + 80)) }} notMerge lazyUpdate={false} />}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">账户</th>
                      <th className="px-2 py-1.5 text-left font-medium">品种</th>
                      <th className="px-2 py-1.5 text-right font-medium">净市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">总市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">净手数</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="账户行是该对象下最长连续持有天数；展开后各品种是当前方向连续未清空的自然日，换月连续计算。">已持有</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="该交易员历史平仓的手数加权中位持有天数。本品种平仓不少于 8 笔时用本品种，否则用该账户全部品种。展开后可见。">惯用持仓</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="仍未平仓的手数，按开仓价相对今结算价计算的盈亏。">浮动盈亏</th>
                      <th className="px-2 py-1.5 text-right font-medium">占该对象</th>
                      <th className="px-2 py-1.5 text-right font-medium">占该账户</th>
                    </tr>
                  </thead>
                  <HoldersTable holders={obj.holders} holderSort={obj.holderSort} />
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                默认按账户汇总该对象下的持仓；有多个品种时点击账户行展开明细。
                账户排序按{obj.holderSort === "gross" ? "总市值（净市值接近轧平，因此以总暴露为准）" : "净市值绝对值"}。占该对象的分母是上述口径的合计。
                已持有是自然日：从该账户在这个品种上当前方向第一次有仓算到报告日，换月连续计算；多空对锁则从最近一次清空之后重新有仓算起。手数天数是仍未平仓的手数按开仓日加权，换月后会比已持有短。数字偏黄表示这笔未平仓已经长于该交易员的惯用持仓。
                惯用持仓是历史平仓的手数加权中位天数，本品种不少于 8 笔时用本品种，否则用该账户全部品种。
                浮动盈亏按未平仓手数的开仓价相对今结算价计算。鼠标停在格子上可看最早开仓和另一口径的中位天数。
              </p>
              <p className="text-xs leading-6">{obj.cutNote}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">账户</th>
                      <th className="px-2 py-1.5 text-left font-medium">品种</th>
                      <th className="px-2 py-1.5 text-left font-medium">方向</th>
                      <th className="px-2 py-1.5 text-left font-medium" title="浮亏且持有超过该交易员惯用天数的仓位少留；报告日当天新开的少动；其余按净市值。">依据</th>
                      <th className="px-2 py-1.5 text-right font-medium">当前市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">目标市值</th>
                      <th className="px-2 py-1.5 text-right font-medium">建议减绝对额</th>
                      <th className="px-2 py-1.5 text-right font-medium">当前手</th>
                      <th className="px-2 py-1.5 text-right font-medium">目标手</th>
                      <th className="px-2 py-1.5 text-right font-medium">建议减/回补手</th>
                    </tr>
                  </thead>
                  <CutsTable cuts={obj.cuts} />
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                按账户汇总。市值和手数是各品种净值相加；建议减绝对额和减/回补手是各品种相加。方向不一致时账户行显示多空，依据不一致时显示见各品种。有多个品种时点击账户行展开明细。
              </p>
              {obj.residualCuts.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  尾仓未写入减仓指令（占比过小，主要由大户贡献拥挤）：{obj.residualCuts.map((row) => `${row.displayName} ${row.prodLabel} ${formatYuan(row.currentMv)}`).join("；")}。
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                缩放系数 k={obj.k.toFixed(3)}{obj.kMethod === "bisection" ? `，按相关性回算后目标贡献约 ${obj.achievedShare ?? obj.targetPct}%` : "，按贡献占比线性估算"}。这个 k 决定减多少总额，不决定每个账户少留的比例。
              </p>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">账户层预警 / 止损</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {accountActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">最新可用结算日，没有账户进入自身预警线上 2 个百分点以内，也没有触及预警或止损。这一层按权益/净入金判断，已把提盈从分母中扣除，不是保证金风险度。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">账户</th>
                    <th className="px-2 py-1.5 text-right font-medium">权益/净入金</th>
                    <th className="px-2 py-1.5 text-right font-medium">自身预警/止损</th>
                    <th className="px-2 py-1.5 text-left font-medium">建议</th>
                    <th className="px-2 py-1.5 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {accountActions.map((row) => (
                    <tr key={row.account} className="border-b last:border-0 align-top">
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.displayName}<div className="text-[10px] text-muted-foreground">{row.asOfDate} 权益</div></td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatRatioPct(row.ratio)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.warningStopLoss ?? `${formatRatioPct(row.warnPct, 0)} / ${formatRatioPct(row.stopPct, 0)}`}</td>
                      <td className="px-2 py-1.5"><Badge variant="outline" className={actionClass(row.action)}>{row.action}</Badge></td>
                      <td className="px-2 py-1.5 leading-5">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            口径对齐日间风控 VaR 沙盘与边际贡献时序（vol=20 日，corr=252 日，含当日窗口）。禁止新增针对越线的品种或板块本身，适用于任何会增加该对象绝对暴露的账户，包括新开仓。正式硬砍只在硬线持续不少于 3 个交易日，并且持仓是 VaR 上升主因或 VaR/资本已超过 2.07% 时提出；市场驱动日冻结集中度硬砍。账户层只限制该账户新增；若已跌破止损且仍有持仓，则上报投资经理共同决策，首次触及止损不等于自动清仓。风格漂移、持亏加码等旗标不在此自动变成禁开或减仓指令。
          </p>
          {gapNotes.map((note) => (
            <p key={note} className="text-[10px] text-muted-foreground">{note}</p>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
