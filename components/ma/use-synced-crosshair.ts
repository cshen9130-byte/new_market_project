"use client"

import { useEffect, type RefObject } from "react"
import type ReactECharts from "echarts-for-react"

import { crosshairIndex } from "@/lib/client/linked-crosshair"
import type { TimeframeId } from "@/lib/client/timeframes"

export function useSyncedCrosshair(
  chartRef: RefObject<ReactECharts | null>,
  timesRef: RefObject<number[]>,
  cursorTime: number | null | undefined,
  interval: TimeframeId,
  revision: unknown,
) {
  useEffect(() => {
    let inst: ReturnType<ReactECharts["getEchartsInstance"]> | null = null
    try {
      inst = chartRef.current?.getEchartsInstance() ?? null
    } catch {
      return
    }
    if (!inst) return
    const hide = () => {
      inst.dispatchAction({ type: "hideTip" })
      inst.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" })
    }
    try {
      if (cursorTime == null) {
        hide()
        return
      }
      const idx = crosshairIndex(timesRef.current ?? [], cursorTime, interval)
      if (idx < 0) {
        hide()
        return
      }
      inst.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: idx })
    } catch {
      // The chart can still be laying out when the first hover arrives.
    }
  }, [chartRef, cursorTime, interval, revision, timesRef])
}
