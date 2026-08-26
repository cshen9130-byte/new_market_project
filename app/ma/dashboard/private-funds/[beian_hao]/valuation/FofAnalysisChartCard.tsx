"use client"

import type { ReactNode } from "react"
import { ChartCalcHelpButton, type ChartCalcHelp } from "./ChartCalcHelpButton"

export function FofAnalysisChartCard({
  title,
  hint,
  extra,
  calcHelp,
  children,
}: {
  title: string
  hint?: string
  extra?: ReactNode
  calcHelp?: ChartCalcHelp
  children: ReactNode
}) {
  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 pb-1">
        <div>
          <div className="flex items-center gap-1">
            <div className="text-red-500 font-semibold text-sm">{title}</div>
            {calcHelp && (
              <ChartCalcHelpButton
                heading={calcHelp.heading ?? `${title} · 计算说明`}
                blocks={calcHelp.blocks}
              />
            )}
          </div>
          {hint && <div className="text-[11px] text-zinc-400 mt-0.5 leading-4 max-w-3xl">{hint}</div>}
        </div>
        {extra}
      </div>
      <div className="px-2 pb-3">{children}</div>
    </div>
  )
}
