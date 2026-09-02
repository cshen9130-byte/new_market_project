"use client"

import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"
import {
  applyPctMargin,
  classifyPctDelta,
  exposureDirLabel,
  fmtFlowYuan,
  signalKindLabel,
  signalRowKey,
  signedPctDelta,
  strengthTier,
  type ActionKind,
  type DecisionAction,
  type HistSignalItem,
  type MarginTag,
  type MomSignal,
  type SignalVsPrev,
  type StrengthTier,
} from "@/lib/ma/quant-vs-subjective-signals"

export const ACTION_ORDER: ActionKind[] = ["加码", "暂缓加码", "减码准备", "观望", "补风格", "控拥挤", "扩容"]

const ACTION_RANK: Record<ActionKind, number> = Object.fromEntries(
  ACTION_ORDER.map((a, i) => [a, i]),
) as Record<ActionKind, number>

export function compareByAction<T extends { action: DecisionAction; strength?: number }>(a: T, b: T): number {
  const byAction = (ACTION_RANK[a.action as ActionKind] ?? 99) - (ACTION_RANK[b.action as ActionKind] ?? 99)
  if (byAction !== 0) return byAction
  return (b.strength ?? 0) - (a.strength ?? 0)
}

const ACTION_STYLE: Record<DecisionAction, string> = {
  加码: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  暂缓加码: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-700",
  减码准备: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-900",
  观望: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  补风格: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  控拥挤: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  扩容: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  中性: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-700",
}

const MARGIN_TAG_STYLE: Record<MarginTag, string> = {
  同向加仓: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  同向减仓: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300",
  边际背离: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300",
  分歧收敛: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  分歧加剧: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  一侧变动: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  变化很小: "border-border bg-muted/40 text-muted-foreground",
}

const TIER_STYLE: Record<StrengthTier, string> = {
  强: "text-red-700 dark:text-red-300",
  中: "text-amber-700 dark:text-amber-300",
  弱: "text-muted-foreground",
}

const LEVEL_LABEL: Record<MomSignal["level"], string> = {
  sector: "板块",
  product: "品种",
  allocation: "配置",
}

export type TaggedMomSignal = MomSignal & {
  vsPrev?: SignalVsPrev
  prevAction?: ActionKind
}

export type PrevExposureMap = Map<string, { q: number; s: number }>

function stockDirWord(pct: number | undefined): "多" | "空" {
  return (pct ?? 0) < -0.15 ? "空" : "多"
}

/** 加/减 + 多/空 follow 风贡 今−昨; x/x is accounts that traded that way. */
function sleeveAccountLabel(
  b: NonNullable<MomSignal["flow"]>["quantBreadth"] | undefined,
  todayPct: number | undefined,
  yestPct?: number,
): string | null {
  if (!b || b.total <= 0) return null
  const dir = todayPct != null && Math.abs(todayPct) > 0.15
    ? stockDirWord(todayPct)
    : stockDirWord(yestPct)
  const d = todayPct != null && yestPct != null ? signedPctDelta(todayPct, yestPct) : 0
  let adding: boolean
  if (d !== 0) {
    adding = dir === "空" ? d < 0 : d > 0
  } else {
    const addToBook = dir === "空" ? b.cut : b.add
    const cutFromBook = dir === "空" ? b.add : b.cut
    if (addToBook <= 0 && cutFromBook <= 0) return null
    adding = addToBook > cutFromBook
  }
  const n = adding
    ? (dir === "空" ? b.cut : b.add)
    : (dir === "空" ? b.add : b.cut)
  if (n <= 0) return null
  return `${adding ? "加" : "减"}${dir}${n}/${b.total}`
}

function signalBreadthLines(signal: MomSignal): string[] {
  const flow = signal.flow
  if (!flow) return []
  const q = sleeveAccountLabel(flow.quantBreadth, signal.quantPct)
  const s = sleeveAccountLabel(flow.subjBreadth, signal.subjPct)
  return [
    q ? `量化${q}` : null,
    s ? `主观${s}` : null,
  ].filter((x): x is string => Boolean(x))
}

function pctClass(n: number): string {
  if (n > 0.15) return "text-red-600 dark:text-red-400"
  if (n < -0.15) return "text-emerald-600 dark:text-emerald-400"
  return "text-muted-foreground"
}

function vsYesterdayArrow(today: number, yesterday: number) {
  const d = signedPctDelta(today, yesterday)
  if (d > 0) return <span className="ml-0.5 text-red-500">↑</span>
  if (d < 0) return <span className="ml-0.5 text-emerald-500">↓</span>
  return null
}

function ExposurePair({ today, yesterday }: { today: number | undefined; yesterday: number | undefined }) {
  const arrow = today != null && yesterday != null ? vsYesterdayArrow(today, yesterday) : null
  return (
    <td className="py-1 px-1.5 align-top text-right tabular-nums whitespace-nowrap">
      <div className={today != null ? pctClass(today) : "text-muted-foreground"}>
        {today != null ? <>{exposureDirLabel(today)}{arrow}</> : "—"}
      </div>
      <div className={`text-[10px] leading-4 ${yesterday != null ? pctClass(yesterday) : "text-muted-foreground"}`}>
        {yesterday != null ? `昨 ${exposureDirLabel(yesterday)}` : ""}
      </div>
    </td>
  )
}

function VsPrevBadge({
  vsPrev,
  prevAction,
}: {
  vsPrev?: SignalVsPrev
  prevAction?: ActionKind
}) {
  if (vsPrev === "new") {
    return (
      <span className="shrink-0 rounded border border-red-200 bg-red-50 px-1 py-0 text-[10px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        新增
      </span>
    )
  }
  if (vsPrev === "changed" && prevAction) {
    return (
      <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 py-0 text-[10px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        昨日{prevAction}
      </span>
    )
  }
  return null
}

function SignalHoverDetail({ signal }: { signal: MomSignal }) {
  const flow = signal.flow
  const breadth = signalBreadthLines(signal).join(" · ")
  return (
    <div className="space-y-1.5">
      <p>{signal.detail}</p>
      {flow && flow.tag !== "变化很小" && (
        <p className="tabular-nums opacity-90">
          {flow.tag}{flow.cutPnl ? ` · ${flow.cutPnl}` : ""}
          <br />
          量化 {fmtFlowYuan(flow.q1d)} · 主观 {fmtFlowYuan(flow.s1d)}
          <br />
          5日 {fmtFlowYuan(flow.q5d)} / {fmtFlowYuan(flow.s5d)}
        </p>
      )}
      {breadth ? <p className="opacity-90">{breadth}</p> : null}
    </div>
  )
}

export function MomSignalTable({
  signals,
  prevExposure,
  gone = [],
  nameHeader = "板块/品种",
  showLevel = true,
  showPrevChange = true,
  onRowClick,
  activeKey,
  caption,
  emptyText = "当前截面没有达到阈值的信号。",
}: {
  signals: TaggedMomSignal[]
  prevExposure: PrevExposureMap
  gone?: HistSignalItem[]
  nameHeader?: string
  showLevel?: boolean
  showPrevChange?: boolean
  onRowClick?: (signal: TaggedMomSignal) => void
  activeKey?: string
  caption?: ReactNode
  emptyText?: string
}) {
  const rows = signals.slice().sort(compareByAction)
  const goneRows = gone.slice().sort(compareByAction)

  if (!rows.length && !goneRows.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{emptyText}</p>
  }

  return (
    <>
      {caption}
      <div>
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">决策</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">{nameHeader}</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">解读</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">强弱</th>
              <th className="text-right py-1 px-1.5 font-medium whitespace-nowrap">量化风贡</th>
              <th className="text-right py-1 px-1.5 font-medium whitespace-nowrap">主观风贡</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">边际</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">量化户</th>
              <th className="text-left py-1 px-1.5 font-medium whitespace-nowrap">主观户</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const clickable = Boolean(onRowClick) && (s.level === "product" || s.level === "sector")
              const active = Boolean(activeKey) && activeKey === `${s.level}:${s.key}`
              const prev = prevExposure.get(signalRowKey(s.level, s.key))
              const aligned = applyPctMargin(s, prev)
              const tier = strengthTier(aligned.strength)
              const pctMargin = prev && aligned.quantPct != null && aligned.subjPct != null
                ? classifyPctDelta(aligned.quantPct, prev.q, aligned.subjPct, prev.s)
                : null
              const marginTag = pctMargin?.tag ?? aligned.flow?.tag
              const marginLive = Boolean(marginTag && marginTag !== "变化很小")
              const qAcct = sleeveAccountLabel(aligned.flow?.quantBreadth, aligned.quantPct, prev?.q)
              const sAcct = sleeveAccountLabel(aligned.flow?.subjBreadth, aligned.subjPct, prev?.s)
              return (
                <Tooltip key={`${s.level}-${s.key}-${s.type}`}>
                  <TooltipTrigger asChild>
                    <tr
                      onClick={() => {
                        if (clickable) onRowClick?.(s)
                      }}
                      className={`border-b border-border/60 ${clickable ? "cursor-pointer hover:bg-muted/60" : "cursor-default"} ${active ? "bg-muted/80" : ""}`}
                    >
                      <td className="py-1 px-1.5 align-top whitespace-nowrap">
                        <span className={`inline-block rounded border px-1 py-0.5 text-[10px] font-medium ${ACTION_STYLE[aligned.action]}`}>{aligned.action}</span>
                      </td>
                      <td className="py-1 px-1.5 align-top whitespace-nowrap">
                        <div className="flex items-baseline gap-1">
                          <span className="font-medium">{s.name}</span>
                          {showLevel ? (
                            <span className="text-[10px] text-muted-foreground">{LEVEL_LABEL[s.level]}</span>
                          ) : null}
                        </div>
                        {showPrevChange && s.level !== "allocation" && (
                          <div className="mt-0.5">
                            <VsPrevBadge vsPrev={s.vsPrev} prevAction={s.prevAction} />
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1.5 align-top whitespace-nowrap text-muted-foreground">{signalKindLabel(s.type)}</td>
                      <td className={`py-1 px-1.5 align-top whitespace-nowrap tabular-nums ${TIER_STYLE[tier]}`}>
                        <span className="font-medium">{tier}</span>
                        <span className="ml-0.5 text-muted-foreground">{s.strength.toFixed(0)}</span>
                      </td>
                      <ExposurePair today={s.quantPct} yesterday={prev?.q} />
                      <ExposurePair today={s.subjPct} yesterday={prev?.s} />
                      <td className="py-1 px-1.5 align-top whitespace-nowrap">
                        {marginLive && marginTag ? (
                          <span className={`inline-block rounded border px-1 py-0.5 text-[10px] font-medium ${MARGIN_TAG_STYLE[marginTag]}`}>{marginTag}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1 px-1.5 align-top text-[11px] leading-4 text-muted-foreground whitespace-nowrap">
                        {qAcct ?? "—"}
                      </td>
                      <td className="py-1 px-1.5 align-top text-[11px] leading-4 text-muted-foreground whitespace-nowrap">
                        {sAcct ?? "—"}
                      </td>
                    </tr>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" sideOffset={6} className="max-w-sm text-left leading-relaxed whitespace-normal">
                    <SignalHoverDetail signal={aligned} />
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </tbody>
        </table>
      </div>
      {goneRows.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-border p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
            上一交易日有、本日已消失 · {goneRows.length}
          </p>
          <table className="w-max text-xs">
            <tbody>
              {goneRows.map((s) => (
                <tr key={`gone-${s.level}-${s.key}`} className="text-muted-foreground">
                  <td className="py-0.5 pr-2">
                    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium opacity-70 ${ACTION_STYLE[s.action]}`}>{s.action}</span>
                  </td>
                  <td className="py-0.5 pr-2 truncate">{s.name}</td>
                  <td className="py-0.5">昨日{s.action}，本日未再进入名单</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
