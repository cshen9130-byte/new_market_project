"use client"

import { useEffect, useMemo, useState } from "react"
import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"
import { HelpBriefingMomSignals } from "@/components/ma/quant-vs-subjective-help"
import {
  buildMomSignals,
  exposurePct,
  rowDecision,
  rowStrength,
  signalKindLabel,
  signalRowKey,
  strengthTier,
  type ActionKind,
  type DecisionAction,
  type FlowMap,
  type MomSignal,
  type SignalSourceRow,
  type StrengthTier,
} from "@/lib/ma/quant-vs-subjective-signals"

const ACTION_STYLE: Record<DecisionAction, { bg: string; color: string; border: string }> = {
  加码: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  暂缓加码: { bg: "#f1f5f9", color: "#334155", border: "#cbd5e1" },
  减码准备: { bg: "#fdf2f8", color: "#be185d", border: "#fbcfe8" },
  观望: { bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
  补风格: { bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
  控拥挤: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  扩容: { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  中性: { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
}

const ACTION_ORDER: ActionKind[] = ["加码", "暂缓加码", "减码准备", "观望", "补风格", "控拥挤", "扩容"]

interface ApiData {
  ok: boolean
  date?: string | null
  quantShare?: number
  sectors?: SignalSourceRow[]
  products?: SignalSourceRow[]
  signals?: MomSignal[]
  groups?: { quant: { nAccounts: number }; subjective: { nAccounts: number } } | null
  volDays?: number
  flows?: FlowMap
  error?: string
}

function countLine(signals: MomSignal[]): string {
  const parts = ACTION_ORDER
    .map((action) => {
      const n = signals.filter((s) => s.action === action).length
      return n > 0 ? `${action} ${n} 条` : null
    })
    .filter(Boolean)
  return parts.join("、") || "无达到阈值的信号"
}

function fmtPct(n: number, signed = true): string {
  const body = `${Math.abs(n).toFixed(1)}%`
  if (!signed) return body
  if (n > 0.05) return `+${body}`
  if (n < -0.05) return `-${body}`
  return body
}

function pctColor(n: number): string {
  if (n > 0.15) return "#dc2626"
  if (n < -0.15) return "#059669"
  return "#64748b"
}

const TIER_STYLE: Record<StrengthTier, string> = {
  强: "#b91c1c",
  中: "#b45309",
  弱: "#64748b",
}

function ActionBadge({ action }: { action: DecisionAction }) {
  const tone = ACTION_STYLE[action]
  return (
    <span
      className="inline-block shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none"
      style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}
    >
      {action}
    </span>
  )
}

export default function BriefingMomSignals() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [signals, setSignals] = useState<MomSignal[]>([])
  const [sectors, setSectors] = useState<SignalSourceRow[]>([])
  const [flows, setFlows] = useState<FlowMap | undefined>(undefined)
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
          setSectors([])
          return
        }
        setDate(j.date ?? null)
        setSectors(j.sectors ?? [])
        setFlows(j.flows)
        setVolDays(j.volDays ?? 20)
        const built = buildMomSignals(
          j.sectors ?? [],
          (j.products ?? []).slice(0, 40),
          "risk",
          j.quantShare ?? 0,
          j.groups?.quant.nAccounts ?? 0,
          j.groups?.subjective.nAccounts ?? 0,
          j.flows,
        )
        setSignals(built.length ? built : (j.signals ?? []))
      })
      .catch((e) => {
        if (stop) return
        setError(e instanceof Error ? e.message : "请求失败")
        setSignals([])
        setSectors([])
      })
      .finally(() => {
        if (!stop) setLoading(false)
      })
    return () => { stop = true }
  }, [])

  const summary = useMemo(() => countLine(signals), [signals])

  const sectorRows = useMemo(() => {
    return [...sectors]
      .map((row) => {
        const q = exposurePct(row.quant, "risk")
        const s = exposurePct(row.subjective, "risk")
        const decision = rowDecision(row.quant, row.subjective, "risk", flows?.[signalRowKey("sector", row.key)])
        const strength = rowStrength(row.quant, row.subjective, "risk", flows?.[signalRowKey("sector", row.key)])
        return { row, q, s, decision, strength, weight: Math.abs(q) + Math.abs(s) }
      })
      .sort((a, b) => b.weight - a.weight)
  }, [sectors, flows])

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
        。{summary}。
      </p>

      {sectorRows.length > 0 && (
        <div className="rounded border border-[#d4c9a8] overflow-hidden mb-4" style={{ background: "#ffffff" }}>
          <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed" }}>
            <caption className="text-left px-4 py-2.5 text-sm font-semibold text-[#1a3a5c] border-b border-[#ece6d6]">
              板块决策信号
            </caption>
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr style={{ background: "rgba(26,58,92,0.05)" }}>
                <th className="text-left font-medium text-[#5a6a7a] pl-4 pr-2 py-2">板块</th>
                <th className="text-right font-medium text-[#5a6a7a] px-2 py-2 whitespace-nowrap">量化风险%</th>
                <th className="text-right font-medium text-[#5a6a7a] px-2 py-2 whitespace-nowrap">主观风险%</th>
                <th className="text-left font-medium text-[#5a6a7a] px-2 py-2 whitespace-nowrap">决策信号</th>
                <th className="text-left font-medium text-[#5a6a7a] px-2 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    信号强弱
                    <span className="no-print inline-flex font-sans font-normal">
                      <HelpBriefingMomSignals volDays={volDays} />
                    </span>
                  </span>
                </th>
                <th className="text-left font-medium text-[#5a6a7a] pl-2 pr-4 py-2">解读</th>
              </tr>
            </thead>
            <tbody>
              {sectorRows.map(({ row, q, s, decision, strength }, idx) => {
                const tier = strengthTier(strength)
                return (
                <tr
                  key={row.key}
                  style={{ borderTop: idx === 0 ? undefined : "1px solid #ece6d6" }}
                >
                  <td className="pl-4 pr-2 py-2 font-medium text-[#1a3a5c] truncate">{row.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: pctColor(q) }}>{fmtPct(q)}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: pctColor(s) }}>{fmtPct(s)}</td>
                  <td className="px-2 py-2"><ActionBadge action={decision.action} /></td>
                  <td className="px-2 py-2 whitespace-nowrap" style={{ color: TIER_STYLE[tier] }}>
                    <span className="inline-flex items-baseline gap-1.5 tabular-nums">
                      <span className="w-4 font-medium">{tier}</span>
                      <span className="w-6 text-right text-[#8a9aaa]">{strength.toFixed(0)}</span>
                    </span>
                  </td>
                  <td className="pl-2 pr-4 py-2 text-[#5a6a7a]">{signalKindLabel(decision.kind)}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded border border-[#d4c9a8] overflow-hidden mb-4" style={{ background: "#ffffff" }}>
        {!signals.length ? (
          <p className="text-sm text-[#8a9aaa] py-8 text-center">当前截面没有达到阈值的信号。</p>
        ) : (
          <ul>
            {signals.map((s, idx) => (
              <li
                key={`${s.level}-${s.key}-${s.type}`}
                className="px-4 py-3"
                style={{ borderTop: idx === 0 ? undefined : "1px solid #ece6d6" }}
              >
                <div className="flex items-start gap-2.5">
                  <ActionBadge action={s.action} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-snug text-[#1a3a5c]">{s.title}</div>
                    <p className="text-xs text-[#5a6a7a] mt-1 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
