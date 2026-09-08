"use client"

import type { ReactNode } from "react"
import {
  STRATEGY_UNCONFIGURED,
  STRATEGY_UNCONFIGURED_LABEL,
  isStrategyUnconfigured,
} from "@/lib/ma/strategy-unconfigured"

export type StrategyFilterNode = {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

export type StrategySource = "company" | "platform"

export function StrategySourceToggle({
  value,
  onChange,
  className,
}: {
  value: StrategySource
  onChange: (next: StrategySource) => void
  className?: string
}) {
  const btn = (key: StrategySource, label: string) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      className={[
        "px-2.5 py-1 transition-colors",
        value === key ? "bg-red-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
      ].join(" ")}
    >
      {label}
    </button>
  )
  return (
    <div className={["inline-flex rounded border border-zinc-200 overflow-hidden text-xs", className ?? ""].join(" ")}>
      {btn("company", "团队策略")}
      {btn("platform", "平台策略")}
    </div>
  )
}

const pillActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
const pillIdle = "border-border text-zinc-500 hover:bg-muted/60"
const pillUnlimitedActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
const pillUnlimitedIdle = "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"

function FilterPill({
  active,
  unlimited,
  onClick,
  children,
}: {
  active: boolean
  unlimited?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <span
      onClick={onClick}
      className={[
        "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
        unlimited ? "font-medium" : "",
        active ? (unlimited ? pillUnlimitedActive : pillActive) : (unlimited ? pillUnlimitedIdle : pillIdle),
      ].join(" ")}
    >
      {children}
    </span>
  )
}

export function StrategyFilterRows({
  hierarchy,
  strategyL1,
  strategyL2,
  strategyL3,
  onL1Change,
  onL2Change,
  onL3Change,
  leading,
  l1Label = "一级策略",
  l2Label = "二级策略",
  l3Label = "三级策略",
  showL3 = true,
}: {
  hierarchy: StrategyFilterNode[]
  strategyL1: string
  strategyL2: string
  strategyL3?: string
  onL1Change: (next: string) => void
  onL2Change: (next: string) => void
  onL3Change?: (next: string) => void
  leading?: ReactNode
  l1Label?: string
  l2Label?: string
  l3Label?: string
  showL3?: boolean
}) {
  const l2Options = strategyL1 && !isStrategyUnconfigured(strategyL1)
    ? (hierarchy.find((n) => n.l1 === strategyL1)?.l2s ?? [])
    : []
  const showL2Row = Boolean(strategyL1) && !isStrategyUnconfigured(strategyL1)
  const l3Options = strategyL2 && !isStrategyUnconfigured(strategyL2)
    ? (l2Options.find((n) => n.l2 === strategyL2)?.l3s ?? [])
    : []
  const showL3Row = showL3 && Boolean(strategyL2) && !isStrategyUnconfigured(strategyL2)

  return (
    <>
      <div className="flex items-start px-4 py-2">
        <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l1Label}：</span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {leading}
          <FilterPill unlimited active={!strategyL1} onClick={() => onL1Change("")}>
            不限
          </FilterPill>
          {hierarchy.map((node) => (
            <FilterPill
              key={node.l1}
              active={strategyL1 === node.l1}
              onClick={() => onL1Change(strategyL1 === node.l1 ? "" : node.l1)}
            >
              {node.l1}
            </FilterPill>
          ))}
          <FilterPill
            active={isStrategyUnconfigured(strategyL1)}
            onClick={() => onL1Change(isStrategyUnconfigured(strategyL1) ? "" : STRATEGY_UNCONFIGURED)}
          >
            {STRATEGY_UNCONFIGURED_LABEL}
          </FilterPill>
        </div>
      </div>
      {showL2Row && (
        <div className="flex items-start px-4 py-2 bg-muted/20">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l2Label}：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <FilterPill unlimited active={!strategyL2} onClick={() => onL2Change("")}>
              不限
            </FilterPill>
            {l2Options.map((node) => (
              <FilterPill
                key={node.l2}
                active={strategyL2 === node.l2}
                onClick={() => onL2Change(strategyL2 === node.l2 ? "" : node.l2)}
              >
                {node.l2}
              </FilterPill>
            ))}
            <FilterPill
              active={isStrategyUnconfigured(strategyL2)}
              onClick={() => onL2Change(isStrategyUnconfigured(strategyL2) ? "" : STRATEGY_UNCONFIGURED)}
            >
              {STRATEGY_UNCONFIGURED_LABEL}
            </FilterPill>
          </div>
        </div>
      )}
      {showL3Row && (
        <div className="flex items-start px-4 py-2 bg-muted/30">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l3Label}：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <FilterPill unlimited active={!strategyL3} onClick={() => onL3Change?.("")}>
              不限
            </FilterPill>
            {l3Options.map((v) => (
              <FilterPill
                key={v}
                active={strategyL3 === v}
                onClick={() => onL3Change?.(strategyL3 === v ? "" : v)}
              >
                {v}
              </FilterPill>
            ))}
            <FilterPill
              active={isStrategyUnconfigured(strategyL3)}
              onClick={() => onL3Change?.(isStrategyUnconfigured(strategyL3) ? "" : STRATEGY_UNCONFIGURED)}
            >
              {STRATEGY_UNCONFIGURED_LABEL}
            </FilterPill>
          </div>
        </div>
      )}
    </>
  )
}
