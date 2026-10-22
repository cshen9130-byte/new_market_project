import { useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import Svg, { Polyline } from "react-native-svg"
import { fetchIndexQuotes, type QuoteCandle, type QuoteProduct } from "@/api"
import { colors, returnColor } from "@/theme"

const POLL_MS = 8000

function priceText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(1)
}

function intText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function moveOf(product: QuoteProduct) {
  const last = product.quote.last
  const base = product.quote.pre_settlement || product.quote.pre_close
  if (last == null || base == null || base === 0) return null
  const diff = last - base
  return { diff, pct: (diff / base) * 100 }
}

function clock(time: number): string {
  const date = new Date(time * 1000)
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  return `${hour}:${minute}`
}

function thin<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows
  const out: T[] = []
  const step = (rows.length - 1) / (max - 1)
  for (let i = 0; i < max; i += 1) out.push(rows[Math.round(i * step)])
  return out
}

function PriceLine({ candles, color }: { candles: QuoteCandle[]; color: string }) {
  const [width, setWidth] = useState(0)
  const rows = thin(candles, 180)
  const height = 168
  if (rows.length < 2) return <Text style={styles.empty}>分钟线还没到</Text>
  const values = rows.map((row) => row.close)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 8
  const innerW = Math.max(width - pad * 2, 1)
  const innerH = height - pad * 2
  const line = rows
    .map((row, index) => {
      const x = pad + (index / (rows.length - 1)) * innerW
      const y = pad + (1 - (row.close - min) / span) * innerH
      return `${x},${y}`
    })
    .join(" ")
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <Svg width={width} height={height}><Polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" /></Svg> : <View style={{ height }} />}
      <View style={styles.scale}>
        <Text style={styles.scaleText}>{clock(rows[0].time)}</Text>
        <Text style={styles.scaleText}>{priceText(max)}</Text>
        <Text style={styles.scaleText}>{clock(rows[rows.length - 1].time)}</Text>
      </View>
    </View>
  )
}

export default function QuotesScreen() {
  const router = useRouter()
  const [products, setProducts] = useState<QuoteProduct[]>([])
  const [selected, setSelected] = useState("IF")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const seen = useRef(false)
  const busy = useRef(false)
  const loadRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (busy.current) return
      busy.current = true
      try {
        const rows = await fetchIndexQuotes()
        if (cancelled) return
        seen.current = true
        setProducts(rows)
        setError("")
        setSelected((current) => (rows.some((row) => row.product === current) ? current : rows[0]?.product || current))
      } catch (err) {
        if (!cancelled && !seen.current) setError(err instanceof Error ? err.message : "行情加载失败")
      } finally {
        busy.current = false
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    loadRef.current = load
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const focus = useMemo(
    () => products.find((row) => row.product === selected) || products[0] || null,
    [products, selected],
  )
  const move = focus ? moveOf(focus) : null
  const tone = move?.diff ?? 0

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (busy.current) return
              setRefreshing(true)
              void loadRef.current()
            }}
            tintColor={colors.gold}
          />
        }
      >
        <Text style={styles.eyebrow}>行情</Text>
        <Text style={styles.title}>实时行情</Text>
        <Text style={styles.lead}>上证50、沪深300、中证500、中证1000。涨跌相对昨结算。</Text>
        <Pressable
          style={styles.pro}
          onPress={() => router.push(`/quotes-pro?symbol=${encodeURIComponent(focus?.symbol || "IF0")}`)}
        >
          <Text style={styles.proText}>专业交易模式</Text>
        </Pressable>
        {loading && products.length === 0 ? <ActivityIndicator color={colors.ink} style={{ marginTop: 48 }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {products.length > 0 ? (
          <>
            <View style={styles.grid}>
              {products.map((product) => {
                const change = moveOf(product)
                const on = product.product === focus?.product
                return (
                  <Pressable key={product.product} style={[styles.tile, on && styles.tileOn]} onPress={() => setSelected(product.product)}>
                    <Text style={styles.tileName}>{product.name}</Text>
                    <Text style={styles.tileSymbol}>{product.symbol}</Text>
                    <Text style={[styles.tilePrice, { color: returnColor(change?.diff ?? null) }]}>{priceText(product.quote.last)}</Text>
                    <Text style={[styles.tileMove, { color: returnColor(change?.diff ?? null) }]}>
                      {change ? `${change.diff > 0 ? "+" : ""}${change.diff.toFixed(1)}  ${change.pct > 0 ? "+" : ""}${change.pct.toFixed(2)}%` : "—"}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            {focus ? (
              <View style={styles.chartCard}>
                <View style={styles.chartHead}>
                  <View>
                    <Text style={styles.chartTitle}>{focus.name}</Text>
                    <Text style={styles.chartMeta}>
                      {focus.symbol}
                      {focus.quote.update_time ? ` · ${focus.quote.update_time}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.chartPrice, { color: returnColor(tone) }]}>{priceText(focus.quote.last)}</Text>
                </View>
                <PriceLine candles={focus.candles} color={returnColor(tone)} />
                <View style={styles.facts}>
                  <Fact label="买一" value={priceText(focus.quote.bid)} />
                  <Fact label="卖一" value={priceText(focus.quote.ask)} />
                  <Fact label="成交量" value={intText(focus.quote.volume)} />
                  <Fact label="持仓" value={intText(focus.quote.open_interest)} />
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 36 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 14 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4, marginTop: 2 },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  pro: { marginTop: 16, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  proText: { color: colors.bg, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  error: { color: colors.danger, marginTop: 16, fontSize: 13, lineHeight: 18 },
  empty: { color: colors.muted, paddingVertical: 28, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, padding: 12 },
  tileOn: { borderColor: colors.ink },
  tileName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  tileSymbol: { color: colors.muted, fontSize: 11, marginTop: 2, letterSpacing: 0.4 },
  tilePrice: { fontSize: 22, fontWeight: "700", marginTop: 8, letterSpacing: -0.3 },
  tileMove: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  chartCard: { marginTop: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, padding: 14 },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 },
  chartTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chartMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chartPrice: { fontSize: 22, fontWeight: "700" },
  scale: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  scaleText: { color: colors.muted, fontSize: 11 },
  facts: { flexDirection: "row", marginTop: 12 },
  fact: { flex: 1 },
  factLabel: { color: colors.muted, fontSize: 11 },
  factValue: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 2 },
})
