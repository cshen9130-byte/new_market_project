"use client"

import { HelpCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function DrawdownCalcHelpButton({ showExcess = false }: { showExcess?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          aria-label="动态回撤计算说明"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          计算说明
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-3.5 text-xs leading-relaxed text-zinc-600">
        <div className="font-semibold text-zinc-800 mb-2">动态回撤计算说明</div>
        <div className="space-y-2">
          <p>
            对所选区间内每一日净值（或基准点位），先维护截至当日的历史最高值（峰值），再按：
          </p>
          <p className="rounded bg-zinc-50 px-2.5 py-2 font-mono text-[11px] text-zinc-700 tabular-nums">
            回撤(%) = (当日净值 − 历史峰值) / 历史峰值 × 100
          </p>
          <p>
            峰值为区间起点至当日的最大值；净值创新高时回撤为 0%，否则为相对峰值的跌幅（负值）。
            红色虚线为基金在该区间内的最大回撤。
          </p>
          <p>
            基准回撤用同样方法，基于与净值日期对齐后的基准点位计算。
          </p>
          {showExcess && (
            <p>
              超额回撤：先按除法合成超额净值序列（基金累计涨跌相对基准），再对该序列计算动态回撤。
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
