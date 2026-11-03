"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react"
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

function nearestSeriesValue(inst: EChartsInstance, index: number): number | null {
  const direct = seriesValue(inst, index)
  if (direct != null) return direct
  const option = inst.getOption() as { series?: Array<{ data?: unknown[] }> }
  const length = option.series?.[0]?.data?.length ?? 0
  for (let step = 1; step < length; step += 1) {
    const left = seriesValue(inst, index - step)
    if (left != null) return left
    const right = seriesValue(inst, index + step)
    if (right != null) return right
  }
  return null
}

function indexInGrid(x: number, rect: { x: number; width: number }, count: number): number {
  if (count <= 0 || rect.width <= 0) return -1
  const index = Math.floor((x - rect.x) / (rect.width / count))
  return index >= 0 && index < count ? index : -1
}

/**
 * A hit layer over the chart. ECharts drops its own crosshair on every live redraw,
 * so the cross is drawn in the DOM and stays until the pointer leaves.
 */
export function ChartPointerCapture({
  chartRef,
  timesRef,
  describeRef,
  interval,
  linkedTime,
}: {
  chartRef: RefObject<ReactECharts | null>
  timesRef: RefObject<number[]>
  describeRef?: RefObject<(index: number) => string>
  interval: TimeframeId
  linkedTime?: number | null
}) {
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)
  const pinnedRef = useRef<number | null>(null)

  const move = (event: ReactMouseEvent<HTMLDivElement>) => {
    const inst = chartInstance(chartRef)
    const times = timesRef.current ?? []
    if (!inst || times.length === 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    if (x < 0 || y < 0 || x > box.width || y > box.height) return
    const rect = gridRect(inst)
    const onPlot = x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
    const index = indexInGrid(x, onPlot ? rect : { x: 0, width: box.width }, times.length)
    if (index < 0 || pinnedRef.current === index) return
    pinnedRef.current = index
    setPinnedIndex(index)
  }

  const leave = () => {
    if (pinnedRef.current == null) return
    pinnedRef.current = null
    setPinnedIndex(null)
  }

  const cursorTime = pinnedIndex != null
    ? (timesRef.current?.[pinnedIndex] ?? null)
    : (linkedTime ?? null)

  return (
    <div
      className="absolute inset-0 z-20"
      data-iv-crosshair-host="1"
      onMouseMove={move}
      onMouseLeave={leave}
    >
      <SyncedCrosshairLayer
        chartRef={chartRef}
        timesRef={timesRef}
        describeRef={describeRef}
        cursorTime={cursorTime}
        pinnedIndex={pinnedIndex}
        interval={interval}
        active={cursorTime != null}
      />
    </div>
  )
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
  pinnedIndex = null,
  interval,
  active,
}: {
  chartRef: RefObject<ReactECharts | null>
  timesRef: RefObject<number[]>
  describeRef?: RefObject<(index: number) => string>
  cursorTime: number | null | undefined
  pinnedIndex?: number | null
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
    const times = timesRef.current ?? []
    const idx = pinnedIndex != null && pinnedIndex >= 0
      ? pinnedIndex
      : crosshairIndex(times, cursorTime, interval)
    if (idx < 0 || idx >= times.length) {
      if (markRef.current) {
        markRef.current = null
        setMark(null)
      }
      return
    }
    const rect = gridRect(inst)
    const xRaw = inst.convertToPixel({ xAxisIndex: 0 }, idx)
    const xPixel = Array.isArray(xRaw) ? xRaw[0] : xRaw
    const band = times.length > 0 ? rect.width / times.length : 0
    const x = typeof xPixel === "number" && Number.isFinite(xPixel)
      ? xPixel
      : rect.x + (idx + 0.5) * band
    const value = nearestSeriesValue(inst, idx)
    const yRaw = value == null ? null : inst.convertToPixel({ yAxisIndex: 0 }, value)
    const y = Array.isArray(yRaw) ? yRaw[0] : yRaw
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
  }, [active, chartRef, cursorTime, describeRef, interval, pinnedIndex, timesRef])

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
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-iv-crosshair="1">
      <div
        style={{
          position: "absolute",
          left: mark.x,
          top: mark.top,
          height: mark.height,
          borderLeft: "1px dashed #64748b",
        }}
      />
      {mark.y != null ? (
        <div
          style={{
            position: "absolute",
            top: mark.y,
            left: mark.left,
            width: mark.width,
            borderTop: "1px dashed #64748b",
          }}
        />
      ) : null}
      {mark.y != null ? (
        <div
          style={{
            position: "absolute",
            left: mark.x - 3,
            top: mark.y - 3,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "#0f172a",
            border: "1px solid #e2e8f0",
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
