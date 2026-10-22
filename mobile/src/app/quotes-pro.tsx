import { useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchKline, type KlineInterval, type QuoteCandle, type QuoteTick } from "@/api"
import { CandleChart } from "@/components/CandleChart"

const PRODUCTS = [
  { id: "IH", name: "上证50", symbol: "IH0" },
  { id: "IF", name: "沪深300", symbol: "IF0" },
  { id: "IC", name: "中证500", symbol: "IC0" },
  { id: "IM", name: "中证1000", symbol: "IM0" },
]

const INTERVALS: Array<{ id: KlineInterval; label: string }> = [
  { id: "1m", label: "1分" },
  { id: "5m", label: "5分" },
  { id: "15m", label: "15分" },
  { id: "30m", label: "30分" },
  { id: "1h", label: "1时" },
  { id: "1d", label: "日线" },
]

const INK = "#131722"
const PANEL = "#1E222D"
const LINE = "#2A2E39"
const TEXT = "#D1D4DC"
const MUTED = "#787B86"
const UP = "#E5484D"
const DOWN = "#12B76A"

function one(value: string | string[] | undefined, fallback: string) {
  const raw = Array.isArray(value) ? value[0] : value
  return raw || fallback
}

function priceText(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(1)
}

function stamp(time: number, frame: KlineInterval) {
  const date = new Date(time * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  if (frame === "1d") return `${month}-${day}`
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  return `${hour}:${minute}`
}

export default function QuotesProScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ symbol?: string | string[] }>()
  const initial = one(params.symbol, "IF0").toUpperCase()
  const [symbol, setSymbol] = useState(PRODUCTS.some((item) => item.symbol === initial) ? initial : "IF0")
  const [frame, setFrame] = useState<KlineInterval>("5m")
  const [candles, setCandles] = useState<QuoteCandle[]>([])
  const [quote, setQuote] = useState<QuoteTick | null>(null)
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const [bars, setBars] = useState(48)

  useEffect(() => {
    const key = `${symbol}:${frame}`
    let cancelled = false
    async function load() {
      try {
        const next = await fetchKline(symbol, frame)
        if (cancelled) return
        setCandles(next.candles)
        setQuote(next.quote)
        setLoadedKey(key)
        setError(next.candles.length ? "" : "这一档暂时没有K线")
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "K线加载失败")
      }
    }
    void load()
    const timer = setInterval(() => void load(), frame === "1d" ? 60000 : 20000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [symbol, frame])

  const ready = loadedKey === `${symbol}:${frame}`
  const shown = useMemo(() => candles.slice(-Math.max(16, bars)), [candles, bars])
  const last = shown[shown.length - 1]
  const base = quote?.pre_settlement || quote?.pre_close || null
  const lastPrice = quote?.last ?? last?.close ?? null
  const diff = lastPrice != null && base ? lastPrice - base : null
  const tone = diff == null || diff === 0 ? TEXT : diff > 0 ? UP : DOWN
  const product = PRODUCTS.find((item) => item.symbol === symbol)

  function zoom(direction: "in" | "out" | "reset") {
    if (direction === "reset") {
      setBars(frame === "1d" ? 90 : 48)
      return
    }
    setBars((current) => {
      const next = direction === "in" ? Math.round(current * 0.7) : Math.round(current / 0.7)
      return Math.max(16, Math.min(candles.length || 400, next))
    })
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.brand}>专业交易</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
        {PRODUCTS.map((item) => {
          const on = item.symbol === symbol
          return (
            <Pressable key={item.id} style={[styles.chip, on && styles.chipOn]} onPress={() => { setSymbol(item.symbol); setBars(frame === "1d" ? 90 : 48) }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.id}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
        {INTERVALS.map((item) => {
          const on = item.id === frame
          return (
            <Pressable
              key={item.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => {
                setFrame(item.id)
                setBars(item.id === "1d" ? 90 : 48)
              }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <View style={styles.head}>
        <View>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={styles.name}>{product?.name}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.last, { color: tone }]}>{priceText(lastPrice)}</Text>
          <Text style={[styles.diff, { color: tone }]}>
            {diff == null || !base ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}  ${diff > 0 ? "+" : ""}${((diff / base) * 100).toFixed(2)}%`}
          </Text>
        </View>
      </View>
      {ready && last ? (
        <View style={styles.ohlc}>
          <Text style={styles.ohlcText}>开 {priceText(last.open)}</Text>
          <Text style={styles.ohlcText}>高 {priceText(last.high)}</Text>
          <Text style={styles.ohlcText}>低 {priceText(last.low)}</Text>
          <Text style={styles.ohlcText}>收 {priceText(last.close)}</Text>
        </View>
      ) : null}
      <View style={styles.chart}>
        {!ready ? <ActivityIndicator color={TEXT} style={{ marginTop: 36 }} /> : null}
        {ready && error ? <Text style={styles.error}>{error}</Text> : null}
        {ready && shown.length >= 2 ? <CandleChart candles={shown} /> : null}
        {ready && shown.length >= 2 ? (
          <View style={styles.scale}>
            <Text style={styles.scaleText}>{stamp(shown[0].time, frame)}</Text>
            <Text style={styles.scaleText}>{stamp(shown[Math.floor(shown.length / 2)].time, frame)}</Text>
            <Text style={styles.scaleText}>{stamp(shown[shown.length - 1].time, frame)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.zoom}>
        <Pressable style={styles.zoomBtn} onPress={() => zoom("in")}><Text style={styles.zoomText}>放大</Text></Pressable>
        <Pressable style={styles.zoomBtn} onPress={() => zoom("out")}><Text style={styles.zoomText}>缩小</Text></Pressable>
        <Pressable style={styles.zoomBtn} onPress={() => zoom("reset")}><Text style={styles.zoomText}>复位</Text></Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 4 },
  back: { color: "#8EBAFF", fontSize: 14, fontWeight: "700" },
  brand: { color: TEXT, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  chipRow: { height: 46, flexGrow: 0, marginTop: 8 },
  chips: { paddingHorizontal: 18, gap: 8, alignItems: "center" },
  chip: { minWidth: 44, height: 30, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: PANEL, borderWidth: 1, borderColor: LINE },
  chipOn: { backgroundColor: "#4C84FF", borderColor: "#4C84FF" },
  chipText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: "#FFFFFF" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 18, paddingTop: 16 },
  symbol: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  name: { color: MUTED, fontSize: 12, marginTop: 2 },
  last: { fontSize: 26, fontWeight: "700" },
  diff: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  ohlc: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 10 },
  ohlcText: { color: MUTED, fontSize: 12 },
  chart: { paddingHorizontal: 12, paddingTop: 8 },
  error: { color: UP, fontSize: 13, paddingVertical: 12 },
  scale: { flexDirection: "row", justifyContent: "space-between", paddingRight: 52, marginTop: 2 },
  scaleText: { color: MUTED, fontSize: 11 },
  zoom: { flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingTop: 8 },
  zoomBtn: { flex: 1, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: LINE, backgroundColor: PANEL },
  zoomText: { color: TEXT, fontSize: 13, fontWeight: "700" },
})
