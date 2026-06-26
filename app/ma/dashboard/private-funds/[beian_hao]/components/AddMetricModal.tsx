"use client"

import { useState } from "react"
import type React from "react"

export type AddedMetricCol = {
  id: string
  period: string
  metric: string
  label: string
}

export const ADD_METRIC_PERIODS = [
  "本周", "本月", "近一周", "近一月", "近三月",
  "近六月", "近一年", "近两年", "近三年", "近五年",
  "今年以来", "成立以来", "2018", "2019", "2020",
  "2021", "2022", "2023", "2024", "2025", "2026",
]

export const ADD_METRIC_GROUPS = [
  ["收益", "年化收益", "超额收益", "超额年化收益", "年化波动率", "超额年化波动率", "夏普比率", "超额夏普比率", "卡玛比率"],
  ["超额卡玛比率", "索提诺比率", "下行标准差", "下行风险", "最大回撤", "超额最大回撤", "最大回撤回补期（天）", "Alpha", "Beta"],
  ["跟踪误差", "信息比率", "偏度", "峰度", "VaR（95%置信）", "周胜率", "最长连续不创新高天数（天）"],
]

export function AddMetricModal({
  initial,
  onConfirm,
  onClose,
}: {
  initial: AddedMetricCol[]
  onConfirm: (cols: AddedMetricCol[]) => void
  onClose: () => void
}) {
  const [selPeriod, setSelPeriod] = useState("近一月")
  const [selected, setSelected] = useState<AddedMetricCol[]>(initial)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  function isChecked(metric: string) {
    return selected.some((c) => c.period === selPeriod && c.metric === metric)
  }

  function toggle(metric: string) {
    if (isChecked(metric)) {
      setSelected((s) => s.filter((c) => !(c.period === selPeriod && c.metric === metric)))
    } else {
      setSelected((s) => [
        ...s,
        { id: `${selPeriod}__${metric}`, period: selPeriod, metric, label: `${selPeriod}${metric}` },
      ])
    }
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const arr = [...selected]
    const [item] = arr.splice(dragIdx, 1)
    arr.splice(idx, 0, item)
    setSelected(arr)
    setDragIdx(idx)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white border border-zinc-200 rounded-lg shadow-xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <span className="font-semibold text-sm text-zinc-800">选择指标</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 p-5 overflow-auto border-r border-zinc-100 min-w-0">
            <div className="text-xs text-zinc-500 mb-3">可选指标</div>
            <div className="grid grid-cols-5 gap-y-2.5 gap-x-2 mb-5 pb-4 border-b border-zinc-100">
              {ADD_METRIC_PERIODS.map((period) => (
                <label key={period} className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-zinc-700">
                  <input
                    type="radio"
                    name="interval-add-metric-period"
                    checked={selPeriod === period}
                    onChange={() => setSelPeriod(period)}
                    className="accent-red-500 cursor-pointer"
                  />
                  {period}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-6">
              {ADD_METRIC_GROUPS.map((group, gi) => (
                <div key={gi} className="flex flex-col gap-y-3">
                  {group.map((metric) => (
                    <label key={metric} className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-zinc-700">
                      <input
                        type="checkbox"
                        checked={isChecked(metric)}
                        onChange={() => toggle(metric)}
                        className="accent-red-500 cursor-pointer rounded"
                      />
                      {metric}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="w-56 flex-shrink-0 p-4 flex flex-col bg-zinc-50/40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-zinc-500">已选指标({selected.length})</span>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
              >
                清空
              </button>
            </div>
            <div className="flex-1 overflow-auto min-h-[200px]">
              {selected.map((col, idx) => (
                <div
                  key={col.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={() => setDragIdx(null)}
                  className="flex items-center gap-1.5 px-2 py-1.5 mb-1 text-xs rounded border border-zinc-200 bg-white cursor-grab select-none hover:bg-zinc-50 transition-colors"
                >
                  <span className="text-zinc-300">⠇</span>
                  <span className="flex-1 truncate text-zinc-700">{col.label}</span>
                  <button
                    type="button"
                    className="text-zinc-400 hover:text-zinc-700 flex-shrink-0"
                    onClick={() => setSelected((s) => s.filter((_, i) => i !== idx))}
                    aria-label={`移除${col.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400 mt-2">已选列表可拖拉上下排序</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-3 border-t border-zinc-100 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-zinc-200 rounded text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
            className="px-4 py-1.5 bg-zinc-300 text-white rounded text-sm hover:bg-zinc-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed enabled:bg-red-500 enabled:hover:bg-red-600"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
