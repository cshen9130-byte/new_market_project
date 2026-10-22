import { Fragment, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import Svg, { Line, Rect } from "react-native-svg"
import type { QuoteCandle } from "@/api"

const UP = "#E5484D"
const DOWN = "#12B76A"
const GRID = "#2A2E39"
const AXIS = "#787B86"

function yOf(price: number, min: number, span: number, top: number, height: number) {
  return top + (1 - (price - min) / span) * height
}

export function CandleChart({ candles }: { candles: QuoteCandle[] }) {
  const [width, setWidth] = useState(0)
  const chartH = 248
  const volH = 52
  const padL = 6
  const padR = 52
  const padT = 10
  const gap = 8
  const height = padT + chartH + gap + volH + 4

  if (candles.length < 2) {
    return <Text style={styles.empty}>K 线还没到</Text>
  }

  const lows = candles.map((bar) => Math.min(bar.low, bar.open, bar.close))
  const highs = candles.map((bar) => Math.max(bar.high, bar.open, bar.close))
  const min = Math.min(...lows)
  const max = Math.max(...highs)
  const span = max - min || 1
  const maxVol = Math.max(...candles.map((bar) => bar.volume), 1)
  const innerW = Math.max(width - padL - padR, 1)
  const slot = innerW / candles.length
  const bodyW = Math.max(1.4, slot * 0.64)
  const y = (price: number) => yOf(price, min, span, padT, chartH)
  const volTop = padT + chartH + gap

  return (
    <View style={{ height }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={padL} y1={y(max)} x2={width - padR} y2={y(max)} stroke={GRID} strokeWidth={1} />
          <Line x1={padL} y1={y((max + min) / 2)} x2={width - padR} y2={y((max + min) / 2)} stroke={GRID} strokeWidth={1} />
          <Line x1={padL} y1={y(min)} x2={width - padR} y2={y(min)} stroke={GRID} strokeWidth={1} />
          {candles.map((bar, index) => {
            const up = bar.close >= bar.open
            const color = up ? UP : DOWN
            const cx = padL + slot * index + slot / 2
            const high = Math.max(bar.high, bar.open, bar.close)
            const low = Math.min(bar.low, bar.open, bar.close)
            const bodyTop = y(Math.max(bar.open, bar.close))
            const bodyBottom = y(Math.min(bar.open, bar.close))
            const bodyH = Math.max(1, bodyBottom - bodyTop)
            const volHeight = Math.max(1, (bar.volume / maxVol) * volH)
            return (
              <Fragment key={`${bar.time}-${index}`}>
                <Line x1={cx} y1={y(high)} x2={cx} y2={y(low)} stroke={color} strokeWidth={1} />
                <Rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
                <Rect x={cx - bodyW / 2} y={volTop + volH - volHeight} width={bodyW} height={volHeight} fill={color} opacity={0.55} />
              </Fragment>
            )
          })}
        </Svg>
      ) : null}
      <Text style={[styles.axis, { top: y(max) - 8 }]}>{max.toFixed(1)}</Text>
      <Text style={[styles.axis, { top: y((max + min) / 2) - 8 }]}>{((max + min) / 2).toFixed(1)}</Text>
      <Text style={[styles.axis, { top: y(min) - 8 }]}>{min.toFixed(1)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { color: AXIS, textAlign: "center", paddingVertical: 48 },
  axis: { position: "absolute", right: 0, width: 48, color: AXIS, fontSize: 10, textAlign: "right" },
})
