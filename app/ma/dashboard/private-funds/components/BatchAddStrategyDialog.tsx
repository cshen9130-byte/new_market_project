"use client"

import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import { TEAM_BENCHMARK_OPTIONS } from "@/lib/ma/team-benchmark"
import { StrategyL3MultiSelect } from "./StrategyL3MultiSelect"

export type BatchStrategyMode = "both" | "strategy" | "benchmark"

export type BatchAddStrategyPayload = {
  mode: BatchStrategyMode
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  benchmark: string | null
}

export interface BatchStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

const MODES: { key: BatchStrategyMode; title: string; subtitle: string }[] = [
  { key: "both", title: "策略+基准", subtitle: "全部修改" },
  { key: "strategy", title: "仅策略", subtitle: "团队基准不动" },
  { key: "benchmark", title: "仅基准", subtitle: "团队策略不动" },
]

export { TEAM_BENCHMARK_OPTIONS }

function FieldSelect({
  value,
  onChange,
  placeholder,
  options,
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
  disabled?: boolean
}) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
    </div>
  )
}

export function BatchAddStrategyDialog({
  open,
  strategyHierarchy,
  submitting = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  strategyHierarchy: BatchStrategyNode[]
  submitting?: boolean
  onClose: () => void
  onConfirm: (payload: BatchAddStrategyPayload) => void | Promise<void>
}) {
  const [mode, setMode] = useState<BatchStrategyMode>("both")
  const [l1, setL1] = useState("")
  const [l2, setL2] = useState("")
  const [l3, setL3] = useState<string[]>([])
  const [benchmark, setBenchmark] = useState("")

  useEffect(() => {
    if (!open) return
    setMode("both")
    setL1("")
    setL2("")
    setL3([])
    setBenchmark("")
  }, [open])

  if (!open) return null

  const l2Opts = l1 ? (strategyHierarchy.find((n) => n.l1 === l1)?.l2s ?? []) : []
  const l3Opts = l2 ? (l2Opts.find((n) => n.l2 === l2)?.l3s ?? []) : []
  const strategyEnabled = mode !== "benchmark"
  const benchmarkEnabled = mode !== "strategy"
  const strategyRequired = mode !== "benchmark"
  const benchmarkRequired = mode !== "strategy"
  const canSubmit =
    !submitting
    && (!strategyRequired || !!l1)
    && (!benchmarkRequired || !!benchmark)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">批量添加策略</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((item) => {
              const selected = mode === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setMode(item.key)}
                  className={[
                    "flex items-start gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-red-400 bg-red-50/60 text-red-500 dark:bg-red-950/20"
                      : "border-border hover:bg-muted/50",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded-full border flex items-center justify-center",
                      selected ? "border-red-500" : "border-zinc-300 dark:border-zinc-600",
                    ].join(" ")}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-red-500" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium leading-tight">{item.title}</span>
                    <span className={["block text-xs mt-0.5", selected ? "text-red-400" : "text-zinc-500"].join(" ")}>{item.subtitle}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            对已选产品批量添加团队策略或基准指数，仅内部可见。团队策略的新增、编辑在【运维-数据维护-团队策略】中。
          </div>

          {strategyEnabled && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm shrink-0 w-[5.5rem] text-right whitespace-nowrap">
                  <span className="text-red-500 mr-0.5">*</span>一级策略：
                </span>
                <FieldSelect
                  value={l1}
                  onChange={(v) => { setL1(v); setL2(""); setL3([]) }}
                  placeholder="请选择一级策略"
                  options={strategyHierarchy.map((n) => n.l1)}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm shrink-0 w-[5.5rem] text-right whitespace-nowrap">二级策略：</span>
                <FieldSelect
                  value={l2}
                  onChange={(v) => { setL2(v); setL3([]) }}
                  placeholder="请选择二级策略"
                  options={l2Opts.map((n) => n.l2)}
                  disabled={l2Opts.length === 0}
                />
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-[5.5rem] text-right whitespace-nowrap pt-2">三级策略：</span>
                <div className="flex-1">
                  <StrategyL3MultiSelect
                    value={l3}
                    onChange={setL3}
                    placeholder="请选择三级策略"
                    options={l3Opts}
                    disabled={l3Opts.length === 0}
                  />
                </div>
              </div>
            </>
          )}
          {benchmarkEnabled && (
            <div className="flex items-center gap-3">
              <span className="text-sm shrink-0 w-[5.5rem] text-right whitespace-nowrap">
                <span className="text-red-500 mr-0.5">*</span>团队基准：
              </span>
              <FieldSelect
                value={benchmark}
                onChange={setBenchmark}
                placeholder="请选择团队策略"
                options={TEAM_BENCHMARK_OPTIONS}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm({
              mode,
              strategy_l1: strategyEnabled ? (l1 || null) : null,
              strategy_l2: strategyEnabled ? (l2 || null) : null,
              strategy_l3: strategyEnabled ? (l3.length ? l3.join(",") : null) : null,
              benchmark: benchmarkEnabled ? (benchmark || null) : null,
            })}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "处理中…" : "确 定"}
          </button>
        </div>
      </div>
    </div>
  )
}
