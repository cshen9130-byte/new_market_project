"use client"

import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const SAMPLE_INDICATOR_OPTIONS = ["样本平均值", "样本中位数", "样本排名", "四分位"] as const
export type SampleIndicatorKey = (typeof SAMPLE_INDICATOR_OPTIONS)[number]

export function defaultSampleIndicatorVisibility(): Record<SampleIndicatorKey, boolean> {
  return {
    样本平均值: true,
    样本中位数: true,
    样本排名: true,
    四分位: true,
  }
}

export function SampleIndicatorPicker({
  visible,
  onToggle,
}: {
  visible: Record<SampleIndicatorKey, boolean>
  onToggle: (key: SampleIndicatorKey) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-red-600 hover:text-red-700 transition-colors"
        >
          指标选择
          <ChevronDown className="h-3 w-3 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8.5rem] p-2">
        {SAMPLE_INDICATOR_OPTIONS.map((label) => (
          <button
            key={label}
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onToggle(label)}
            className="flex w-full items-center gap-2 px-1 py-1.5 text-xs text-zinc-800 rounded hover:bg-zinc-50 transition-colors"
          >
            <span
              aria-hidden="true"
              className={[
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded border shrink-0",
                visible[label] ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
              ].join(" ")}
            >
              {visible[label] && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </span>
            {label}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
