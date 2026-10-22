import { useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchAllWeather, type AwOverview, type AwSleeveKey, type AwVariantId } from "@/api"
import { NavChart } from "@/components/NavChart"
import { colors, returnColor } from "@/theme"

const VARIANTS: Array<{ id: AwVariantId; label: string }> = [
  { id: "vol9-20m", label: "9% · 2000万" },
  { id: "vol5-10m", label: "5% · 1000万" },
]

const SLEEVE_COLOR: Record<AwSleeveKey, string> = {
  Equity: "#2563eb",
  Bonds: "#0f766e",
  Gold: "#ca8a04",
  Commodity: "#c2410c",
}

function money(n: number, signed = false): string {
  const rounded = Math.round(n)
  const body = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (!signed) return rounded < 0 ? `-${body}` : body
  if (rounded > 0) return `+${body}`
  if (rounded < 0) return `-${body}`
  return "0"
}

function pctRatio(n: number, signed = false): string {
  const value = n * 100
  const sign = signed && value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function volLabel(n: number): string {
  const value = n * 100
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
}

function listedName(label: string, contract?: string): string {
  if (!contract) return label || "—"
  const zh = label.replace(/\s+[A-Z]{1,3}$/, "").trim()
  return zh ? `${zh} ${contract}` : contract
}

function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows
  const out: T[] = []
  const step = (rows.length - 1) / (max - 1)
  for (let i = 0; i < max; i += 1) out.push(rows[Math.round(i * step)])
  return out
}

export default function AllWeatherScreen() {
  const router = useRouter()
  const [variant, setVariant] = useState<AwVariantId>("vol9-20m")
  const [data, setData] = useState<AwOverview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [panel, setPanel] = useState<"book" | "days" | "backtest">("book")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setData(null)
    fetchAllWeather(variant)
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData(null)
          setError(err instanceof Error ? err.message : "全天候加载失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [variant])

  async function onRefresh() {
    setRefreshing(true)
    try {
      setData(await fetchAllWeather(variant, true))
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  const chart = useMemo(() => {
    if (!data) return []
    const capital = data.book.initialCapital || 1
    const rows = data.book.daily
      .filter((row) => row.date && Number.isFinite(row.equity))
      .map((row) => ({ date: row.date.slice(5), value: (row.equity / capital - 1) * 100 }))
    return downsample(rows, 180)
  }, [data])

  const capital = data?.book.initialCapital ?? 0
  const cum = data ? data.sleeves.reduce((sum, sleeve) => sum + sleeve.cumPnl, 0) : 0
  const daily = data ? data.sleeves.reduce((sum, sleeve) => sum + sleeve.dailyPnl, 0) : 0
  const equity = capital + cum
  const tenor = data?.settings?.contractTenor === "following" ? "下季 / 次主力" : "当月 / 主力"
  const days = data ? [...data.book.daily].reverse().slice(0, 12) : []

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}
      >
        <Text style={styles.eyebrow}>策略</Text>
        <Text style={styles.title}>全天候跟踪</Text>
        <Text style={styles.lead}>
          四袖套等权，风险预算在 10%–40% 浮动。
          {data ? ` 波动目标 ${volLabel(data.strategy.volTarget)} · ${tenor}` : ""}
        </Text>
        <View style={styles.switch}>
          {VARIANTS.map((item) => {
            const on = item.id === variant
            return (
              <Pressable key={item.id} style={[styles.switchItem, on && styles.switchOn]} onPress={() => setVariant(item.id)} disabled={loading && !data}>
                <Text style={[styles.switchText, on && styles.switchTextOn]}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>

        {loading && !data ? (
          <ActivityIndicator color={colors.ink} style={{ marginTop: 48 }} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {data ? (
          <>
            <Text style={styles.asOf}>{data.book.asOf} · 自 {data.book.startedAt} 起</Text>
            <Text style={styles.equity}>{money(equity)}</Text>
            <View style={styles.metrics}>
              <Metric label="当日盈亏" value={money(daily, true)} tone={daily} />
              <Metric label="累计盈亏" value={`${money(cum, true)}  ${pctRatio(capital ? cum / capital : 0, true)}`} tone={cum} />
              <Metric label="保证金" value={`${money(data.totals.margin)}  ${pctRatio(data.totals.marginUtil)}`} />
              <Metric label="开仓" value={`${data.totals.lots} 手`} />
            </View>

            <Text style={styles.section}>累计收益</Text>
            <View style={styles.card}>
              <NavChart points={chart} />
            </View>

            <Text style={styles.section}>袖套</Text>
            <View style={styles.grid}>
              {data.sleeves.map((sleeve) => (
                <View key={sleeve.sleeve} style={styles.sleeve}>
                  <View style={[styles.sleeveBar, { backgroundColor: SLEEVE_COLOR[sleeve.sleeve] }]} />
                  <Text style={styles.sleeveName}>{sleeve.label}</Text>
                  <Text style={styles.sleeveBudget}>预算 {pctRatio(data.strategy.lastBudget[sleeve.sleeve] || 0)}</Text>
                  <Text style={[styles.sleevePnl, { color: returnColor(sleeve.dailyPnl) }]}>当日 {money(sleeve.dailyPnl, true)}</Text>
                  <Text style={[styles.sleevePnl, { color: returnColor(sleeve.cumPnl) }]}>累计 {money(sleeve.cumPnl, true)}</Text>
                  <View style={styles.track}>
                    <View style={[styles.trackFill, { width: `${Math.max(4, Math.min(100, sleeve.riskShare * 100))}%`, backgroundColor: SLEEVE_COLOR[sleeve.sleeve] }]} />
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.switch}>
              {(
                [
                  ["book", "持仓"],
                  ["days", "近日"],
                  ["backtest", "回测"],
                ] as const
              ).map(([id, label]) => {
                const on = panel === id
                return (
                  <Pressable key={id} style={[styles.switchItem, on && styles.switchOn]} onPress={() => setPanel(id)}>
                    <Text style={[styles.switchText, on && styles.switchTextOn]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>

            {panel === "book" ? (
              <>
                {data.isRebalanceDay && (data.rebalanceTrades?.length ?? 0) > 0 ? (
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>今日调仓</Text>
                    {data.rebalanceTrades!.map((trade) => (
                      <View key={`${trade.asset}-${trade.contract}`} style={styles.trade}>
                        <Text style={styles.tradeName}>{listedName(trade.label, trade.contract)}</Text>
                        <Text style={styles.tradeMeta}>
                          {trade.side} {trade.prevLots} → {trade.newLots}
                          {trade.delta > 0 ? `  +${trade.delta}` : `  ${trade.delta}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {data.sleeves.map((sleeve) => (
                  <View key={sleeve.sleeve} style={styles.block}>
                    <View style={styles.blockHead}>
                      <Text style={[styles.blockTitle, { color: SLEEVE_COLOR[sleeve.sleeve] }]}>{sleeve.label}</Text>
                      <Text style={[styles.blockPnl, { color: returnColor(sleeve.dailyPnl) }]}>{money(sleeve.dailyPnl, true)}</Text>
                    </View>
                    {[...sleeve.products]
                      .sort((a, b) => b.margin - a.margin)
                      .map((product) => (
                        <View key={product.asset} style={styles.product}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.productName, product.lots === 0 && styles.dim]}>
                              {listedName(product.label, product.contract)}
                            </Text>
                            <Text style={styles.productMeta}>
                              {product.lots} 手 · {Math.round(product.price).toLocaleString("zh-CN")} · 权重 {(product.targetWeight * 100).toFixed(1)}%
                              {product.lots === 0 ? " · 不足一手" : ""}
                            </Text>
                          </View>
                          <Text style={[styles.productPnl, { color: returnColor(product.dailyPnl) }]}>{money(product.dailyPnl, true)}</Text>
                        </View>
                      ))}
                  </View>
                ))}
              </>
            ) : null}

            {panel === "days" ? (
              <View style={styles.block}>
                {days.map((row) => (
                  <View key={row.date} style={styles.day}>
                    <Text style={styles.dayDate}>{row.date}</Text>
                    <Text style={styles.dayEquity}>{money(row.equity)}</Text>
                    <Text style={[styles.dayPnl, { color: returnColor(row.dailyPnl) }]}>{money(row.dailyPnl, true)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {panel === "backtest" ? (
              <View style={styles.block}>
                <Text style={styles.backRange}>
                  {data.strategy.backtestStart} 至 {data.strategy.backtestEnd}
                </Text>
                <View style={styles.grid}>
                  <Stat label="累计收益" value={pctRatio(data.strategy.summary.cumulativeReturn, true)} tone={data.strategy.summary.cumulativeReturn} />
                  <Stat label="年化收益" value={pctRatio(data.strategy.summary.cagr, true)} tone={data.strategy.summary.cagr} />
                  <Stat label="年化波动" value={pctRatio(data.strategy.summary.annVol)} />
                  <Stat label="Sharpe" value={data.strategy.summary.sharpe.toFixed(2)} />
                  <Stat label="最大回撤" value={pctRatio(data.strategy.summary.maxDrawdown)} tone={data.strategy.summary.maxDrawdown} />
                  <Stat label="再平衡" value={String(data.strategy.summary.nRebalances)} />
                </View>
                {data.strategy.sleeveBacktest.map((row) => (
                  <View key={row.sleeve} style={styles.backRow}>
                    <Text style={styles.backName}>{row.label}</Text>
                    <Text style={styles.backMeta}>收益 {row.cagr} · 波动 {row.vol} · Sharpe {row.sharpe}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone != null && { color: returnColor(tone) }]}>{value}</Text>
    </View>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.statValue, tone != null && { color: returnColor(tone) }]}>{value}</Text>
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
  switch: { flexDirection: "row", gap: 8, marginTop: 16 },
  switchItem: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  switchOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  switchText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  switchTextOn: { color: colors.bg },
  error: { color: colors.danger, marginTop: 16, fontSize: 13, lineHeight: 18 },
  asOf: { color: colors.muted, fontSize: 12, letterSpacing: 0.4, marginTop: 22 },
  equity: { color: colors.text, fontSize: 36, fontWeight: "700", letterSpacing: -0.6, marginTop: 2 },
  metrics: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  metric: { width: "50%", paddingTop: 12, paddingRight: 10 },
  metricLabel: { color: colors.muted, fontSize: 12 },
  metricValue: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  section: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 26, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sleeve: { width: "48%", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, padding: 12, flexGrow: 1 },
  sleeveBar: { width: 22, height: 3, marginBottom: 8 },
  sleeveName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sleeveBudget: { color: colors.muted, fontSize: 12, marginTop: 2 },
  sleevePnl: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  track: { height: 3, backgroundColor: colors.line, marginTop: 10 },
  trackFill: { height: 3 },
  notice: { marginTop: 18, backgroundColor: "#F8F1E4", borderWidth: 1, borderColor: "#E6D3B0", padding: 14 },
  noticeTitle: { color: "#8A5A12", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  trade: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#E6D3B0" },
  tradeName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  tradeMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  block: { marginTop: 16 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  blockTitle: { fontSize: 15, fontWeight: "700" },
  blockPnl: { fontSize: 13, fontWeight: "700" },
  product: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  productName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  productMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  productPnl: { fontSize: 13, fontWeight: "700" },
  dim: { color: colors.muted },
  day: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  dayDate: { width: 108, color: colors.text, fontSize: 14 },
  dayEquity: { flex: 1, color: colors.muted, fontSize: 13, textAlign: "right" },
  dayPnl: { width: 96, fontSize: 14, fontWeight: "700", textAlign: "right" },
  backRange: { color: colors.muted, fontSize: 12, marginBottom: 10 },
  stat: { width: "31%", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, padding: 10, flexGrow: 1 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 4 },
  backRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  backName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  backMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
})
