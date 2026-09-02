"use client"

import { useEffect, useMemo, useState } from "react"
import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"
import { HelpBriefingMomSignals } from "@/components/ma/quant-vs-subjective-help"
import { ACTION_ORDER, MomSignalTable } from "@/components/ma/mom-signal-table"
import {
  applyPctMargin,
  buildMomSignals,
  buildSignalHistory,
  completeSectorRows,
  signalRowKey,
  tagSignalsVsPrev,
  type FlowMap,
  type MomSignal,
  type TsProductPoint,
  type TsSectorPoint,
} from "@/lib/ma/quant-vs-subjective-signals"

interface ApiData {
  ok: boolean
  date?: string | null
  quantShare?: number
  sectors?: { key: string; name: string }[]
  products?: { key: string; name: string; sector?: string }[]
  signals?: MomSignal[]
  groups?: { quant: { nAccounts: number }; subjective: { nAccounts: number } } | null
  volDays?: number
  flows?: FlowMap
  sectorTs?: TsSectorPoint[]
  productTs?: TsProductPoint[]
  error?: string
}

function countLine(signals: MomSignal[]): string {
  const parts: string[] = []
  for (const action of ACTION_ORDER) {
    const n = signals.filter((s) => s.action === action).length
    if (n > 0) parts.push(`${action} ${n} 条`)
  }
  const nNeutral = signals.filter((s) => s.action === "中性").length
  if (nNeutral > 0) parts.push(`中性 ${nNeutral} 条`)
  return parts.join("、") || "无板块"
}

export default function BriefingMomSignals() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [signals, setSignals] = useState<MomSignal[]>([])
  const [sectorTs, setSectorTs] = useState<TsSectorPoint[]>([])
  const [productTs, setProductTs] = useState<TsProductPoint[]>([])
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [volDays, setVolDays] = useState(20)

  useEffect(() => {
    let stop = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ quantIds: QUANT_ACCOUNT_IDS.join(",") })
    fetch(`/ma/api/mom-analysis/quant-vs-subjective?${qs}`)
      .then((r) => r.json())
      .then((j: ApiData) => {
        if (stop) return
        if (j.ok === false) {
          setError(j.error ?? "加载失败")
          setSignals([])
          setSectorTs([])
          setProductTs([])
          return
        }
        setDate(j.date ?? null)
        setSectorTs(j.sectorTs ?? [])
        setProductTs(j.productTs ?? [])
        setProductNames(Object.fromEntries((j.products ?? []).map((p) => [p.key, p.name])))
        setVolDays(j.volDays ?? 20)
        const built = buildMomSignals(
          completeSectorRows(j.sectors ?? []),
          (j.products ?? []).slice(0, 40),
          "risk",
          j.quantShare ?? 0,
          j.groups?.quant.nAccounts ?? 0,
          j.groups?.subjective.nAccounts ?? 0,
          j.flows,
          { includeNeutral: true, limit: 0 },
        )
        setSignals(built.length ? built : (j.signals ?? []))
      })
      .catch((e) => {
        if (stop) return
        setError(e instanceof Error ? e.message : "请求失败")
        setSignals([])
        setSectorTs([])
        setProductTs([])
      })
      .finally(() => {
        if (!stop) setLoading(false)
      })
    return () => { stop = true }
  }, [])

  const signalHistory = useMemo(
    () => buildSignalHistory(sectorTs, productTs, (code) => productNames[code] ?? code),
    [sectorTs, productTs, productNames],
  )
  const prevDay = useMemo(() => {
    if (!date || !signalHistory.length) return undefined
    for (let i = signalHistory.length - 1; i >= 0; i--) {
      if (signalHistory[i].date < date) return signalHistory[i]
    }
    return undefined
  }, [date, signalHistory])

  const prevExposure = useMemo(() => {
    const map = new Map<string, { q: number; s: number }>()
    const prevDate = prevDay?.date
    if (!prevDate) return map
    for (const r of sectorTs) {
      if (r.date === prevDate) map.set(signalRowKey("sector", r.sector), { q: r.quantNetPct, s: r.subjNetPct })
    }
    for (const r of productTs) {
      if (r.date === prevDate) map.set(signalRowKey("product", r.product), { q: r.quantNetPct, s: r.subjNetPct })
    }
    return map
  }, [sectorTs, productTs, prevDay?.date])

  const alignedSignals = useMemo(
    () => signals.map((s) => applyPctMargin(s, prevExposure.get(signalRowKey(s.level, s.key)))),
    [signals, prevExposure],
  )

  const summary = useMemo(
    () => countLine(alignedSignals.filter((s) => s.level === "sector" && s.key !== "其他")),
    [alignedSignals],
  )

  const { tagged: taggedSignals, gone: goneSignals } = useMemo(
    () => tagSignalsVsPrev(alignedSignals, prevDay?.items),
    [alignedSignals, prevDay],
  )

  const sectorSignals = useMemo(
    () => taggedSignals.filter((s) => s.level === "sector" && s.key !== "其他"),
    [taggedSignals],
  )
  const goneSectors = useMemo(
    () => goneSignals.filter((s) => s.level === "sector" && s.key !== "其他"),
    [goneSignals],
  )
  const productSignals = useMemo(
    () => taggedSignals.filter((s) => s.level === "product" && s.action !== "中性"),
    [taggedSignals],
  )
  const goneProducts = useMemo(
    () => goneSignals.filter((s) => s.level === "product"),
    [goneSignals],
  )

  if (loading) {
    return <p className="text-sm text-[#8a9aaa] py-4">加载决策信号…</p>
  }
  if (error) {
    return <p className="text-sm text-red-700 py-4">{error}</p>
  }

  return (
    <>
      <p className="text-sm leading-7 text-[#2a3a4a] mb-4 pl-1 border-l-4 border-[#c8a84b] bg-[#faf7ef] py-2 px-3 rounded-r">
        当前按风险口径生成
        {date ? <>，持仓截面 <span className="font-semibold">{date}</span></> : null}
        。板块 {summary}。
      </p>

      <div className="rounded border border-[#d4c9a8] overflow-hidden mb-4 px-3 py-3" style={{ background: "#ffffff" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <p className="text-sm font-semibold text-[#1a3a5c]">板块决策信号</p>
          <span className="no-print inline-flex">
            <HelpBriefingMomSignals volDays={volDays} />
          </span>
        </div>
        <MomSignalTable
          signals={sectorSignals}
          prevExposure={prevExposure}
          gone={goneSectors}
          nameHeader="板块"
          showLevel={false}
          showPrevChange={Boolean(prevDay)}
          emptyText="当前没有板块数据。"
        />
      </div>

      {productSignals.length + goneProducts.length > 0 && (
        <div className="rounded border border-[#d4c9a8] overflow-hidden mb-4 px-3 py-3" style={{ background: "#ffffff" }}>
          <p className="text-sm font-semibold text-[#1a3a5c] mb-2">品种决策信号</p>
          <MomSignalTable
            signals={productSignals}
            prevExposure={prevExposure}
            gone={goneProducts}
            nameHeader="品种"
            showLevel={false}
            showPrevChange={Boolean(prevDay)}
            emptyText="当前截面没有达到阈值的品种信号。"
          />
        </div>
      )}
    </>
  )
}
