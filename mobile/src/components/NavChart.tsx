import { useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import Svg, { Defs, LinearGradient, Polygon, Polyline, Stop } from "react-native-svg"
import { colors, returnColor } from "@/theme"

type Point = { date: string; value: number }

export function NavChart({ points }: { points: Point[] }) {
  const [width, setWidth] = useState(0)
  const height = 176
  if (points.length < 2) {
    return <Text style={styles.empty}>净值点不足，暂无走势</Text>
  }

  const values = points.map((point) => point.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const padX = 2
  const padY = 10
  const innerW = Math.max(width - padX * 2, 1)
  const innerH = height - padY * 2
  const xy = points.map((point, index) => {
    const x = padX + (index / (points.length - 1)) * innerW
    const y = padY + (1 - (point.value - min) / span) * innerH
    return { x, y }
  })
  const line = xy.map((point) => `${point.x},${point.y}`).join(" ")
  const lastPoint = xy[xy.length - 1]
  const firstPoint = xy[0]
  const area = lastPoint && firstPoint
    ? `${line} ${lastPoint.x},${height} ${firstPoint.x},${height}`
    : ""
  const last = values[values.length - 1] ?? 0
  const stroke = returnColor(last)

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Text style={[styles.endText, { color: stroke }]}>{(last > 0 ? "+" : "") + last.toFixed(2)}%</Text>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity="0.22" />
              <Stop offset="1" stopColor={stroke} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Polygon points={area} fill="url(#fill)" />
          <Polyline points={line} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={styles.scale}>
        <Text style={styles.scaleText}>{points[0]?.date}</Text>
        <Text style={styles.scaleText}>{points[points.length - 1]?.date}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, paddingVertical: 28, textAlign: "center" },
  scale: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  scaleText: { color: colors.muted, fontSize: 11, letterSpacing: 0.3 },
  endText: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
})
