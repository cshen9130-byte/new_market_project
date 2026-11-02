"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type ReactECharts from "echarts-for-react"

import { crosshairIndex } from "@/lib/client/linked-crosshair"
import type { TimeframeId } from "@/lib/client/timeframes"

type EChartsInstance = ReturnType<ReactECharts["getEchartsInstance"]>

type Mark = {
  x: number
  y: number | null
  top: number
  height: number
  left: number
  width: number
  label: string
}

function chartInstance(chartRef: RefObject<ReactECharts | null>): EChartsInstance | null {
  try {
    return chartRef.current?.getEchartsInstance() ?? null
  } catch {
    return null
  }
}

function gridRect(inst: EChartsInstance) {
  const width = inst.getWidth()
  const height = inst.getHeight()
  try {
    const grid = inst.getModel().getComponent("grid", 0) as { coordinateSystem?: { getRect?: () => { x: number; y: number; width: number; height: number } } }
    const rect = grid?.coordinateSystem?.getRect?.()
    if (rect && rect.width > 0 && rect.height > 0) return rect
  } catch {
    // Fall back to the canvas box.
  }
  return { x: 0, y: 0, width, height }
}

function seriesValue(inst: EChartsInstance, index: number): number | null {
  const option = inst.getOption() as { series?: Array<{ data?: unknown[] }> }
  const raw = option.series?.[0]?.data?.[index]
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value?: unknown }).value
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return null
}

/**
 * The linked cross is a DOM line, not an ECharts axis pointer.
 * ECharts drops the pointer on a null daily slot and flashes it on every redraw.
 */
export function SyncedCrosshairLayer({
  chartRef,
  timesRef,
  describeRef,
  cursorTime,
  interval,
  active,
}: {
  chartRef: RefObject<ReactECharts | null>
  timesRef: RefObject<number[]>
  describeRef?: RefObject<(index: number) => string>
  cursorTime: number | null | undefined
  interval: TimeframeId
  active: boolean
}) {
  const [mark, setMark] = useState<Mark | null>(null)
  const markRef = useRef<Mark | null>(null)

  const place = useCallback(() => {
    if (!active || cursorTime == null) {
      if (markRef.current) {
        markRef.current = null
        setMark(null)
      }
      return
    }
    const inst = chartInstance(chartRef)
    if (!inst) return
    const idx = crosshairIndex(timesRef.current ?? [], cursorTime, interval)
    if (idx < 0) {
      if (markRef.current) {
        markRef.current = null
        setMark(null)
      }
      return
    }
    const x = inst.convertToPixel({ xAxisIndex: 0 }, idx)
    const value = seriesValue(inst, idx)
    const y = value == null ? null : inst.convertToPixel({ yAxisIndex: 0 }, value)
    const rect = gridRect(inst)
    if (typeof x !== "number" || !Number.isFinite(x)) return
    const next: Mark = {
      x,
      y: typeof y === "number" && Number.isFinite(y) ? y : null,
      top: rect.y,
      height: rect.height,
      left: rect.x,
      width: rect.width,
      label: describeRef?.current(idx) ?? "",
    }
    const prev = markRef.current
    if (
      prev &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.top === next.top &&
      prev.height === next.height &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.label === next.label
    ) {
      return
    }
    markRef.current = next
    setMark(next)
  }, [active, chartRef, cursorTime, describeRef, interval, timesRef])

  useLayoutEffect(() => {
    place()
  }, [place])

  useEffect(() => {
    if (!active) return
    let inst = chartInstance(chartRef)
    const onFinished = () => place()
    const bind = () => {
      inst = chartInstance(chartRef)
      if (!inst) return false
      inst.on("finished", onFinished)
      place()
      return true
    }
    if (bind()) {
      return () => inst?.off("finished", onFinished)
    }
    const timer = window.setInterval(() => {
      if (bind()) window.clearInterval(timer)
    }, 200)
    return () => {
      window.clearInterval(timer)
      inst?.off("finished", onFinished)
    }
  }, [active, chartRef, place])

  if (!mark) return null
  const labelOnLeft = mark.x > mark.left + mark.width * 0.62
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div
        style={{
          position: "absolute",
          left: mark.x,
          top: mark.top,
          height: mark.height,
          borderLeft: "1px dashed #d1d4dc",
        }}
      />
      {mark.y != null ? (
        <div
          style={{
            position: "absolute",
            top: mark.y,
            left: mark.left,
            width: mark.width,
            borderTop: "1px dashed #d1d4dc",
          }}
        />
      ) : null}
      {mark.label ? (
        <div
          className="absolute whitespace-pre rounded border border-[#2a2e39] bg-[#131722]/95 px-2 py-1 text-[11px] leading-4 text-[#d1d4dc]"
          style={{
            top: Math.max(mark.top + 4, (mark.y ?? mark.top + 8) + 8),
            left: mark.x,
            transform: labelOnLeft ? "translate(calc(-100% - 8px), 0)" : "translate(8px, 0)",
          }}
        >
          {mark.label}
        </div>
      ) : null}
    </div>
  )
}
