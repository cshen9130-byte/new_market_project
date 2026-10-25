import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchFund } from "@/api"
import { NavChart } from "@/components/NavChart"
import { ReturnText } from "@/components/ReturnText"
import { displayFundName, fmtDate, fmtNav, fmtPercentPoints, fmtSignedNumber, parseNum, strategyLine } from "@/format"
import type { FundDetail, NavPoint } from "@/types"
import { colors, returnColor } from "@/theme"

export default function FundScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string | string[] }>()
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code || ""
  const code = (() => {
    let value = String(rawCode || "").trim()
    if (!value) return ""
    try {
      if (/%[0-9A-Fa-f]{2}/.test(value)) value = decodeURIComponent(value)
    } catch {
      // keep
    }
    return value.trim()
  })()
  const [data, setData] = useState<FundDetail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!code) throw new Error("缺少备案号")
    const detail = await fetchFund(code)
    setData(detail)
    setError("")
  }, [code])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  const chart = useMemo(() => buildChart(data?.nav_series ?? []), [data])
  const recent = useMemo(() => [...(data?.nav_series ?? [])].reverse().slice(0, 8), [data])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setRefreshing(false)
    }
  }

  const info = data?.info
  const metrics = data?.metrics
  const title = info ? displayFundName(info.product_name, info.short_name) : code
  const since = fmtPercentPoints(metrics?.ret_since_inception)
  const ytd = fmtPercentPoints(metrics?.ytd_ret)
  const ann = fmtPercentPoints(metrics?.ann_ret)
  const week = fmtPercentPoints(info?.ret_1w)
  const month = fmtPercentPoints(info?.ret_1m)
  const year = fmtPercentPoints(info?.ret_1y)
  const drawdown = parseNum(metrics?.max_drawdown)

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      {loading && !data ? (
        <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
      ) : error && !data ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void onRefresh()}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.up} />}
        >
          <Text style={styles.kicker}>{info?.beian_hao || code}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {[info?.manager, strategyLine([info?.strategy_l1, info?.strategy_l2, info?.strategy_l3])].filter(Boolean).join("  ·  ") || "策略未填写"}
          </Text>
          {info?.inception_date ? <Text style={styles.meta}>成立 {fmtDate(info.inception_date)}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.hero}>
            <Text style={styles.heroValue}>{fmtNav(metrics?.latest_nav)}</Text>
            <Text style={styles.meta}>单位净值 · {fmtDate(metrics?.latest_nav_date)}</Text>
            <Text style={styles.meta}>累计 {fmtNav(metrics?.latest_cum_nav)} · 复权 {fmtNav(metrics?.latest_cum_nav_reinvested)}</Text>
          </View>

          <View style={styles.grid}>
            <Stat label="成立以来" text={since.text} value={since.n} />
            <Stat label="今年以来" text={ytd.text} value={ytd.n} />
            <Stat label="成立年化" text={ann.text} value={ann.n} />
            <Stat label="最大回撤" text={drawdown == null ? "—" : `-${Math.abs(drawdown).toFixed(2)}%`} value={drawdown == null ? null : -Math.abs(drawdown)} />
            <Stat label="近一周" text={week.text} value={week.n} />
            <Stat label="近一月" text={month.text} value={month.n} />
            <Stat label="近一年" text={year.text} value={year.n} />
            <Stat label="夏普" text={fmtSignedNumber(metrics?.sharpe_since_inception ?? info?.sharpe_1y)} value={null} plain />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>成立以来收益</Text>
            <NavChart points={chart} />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>最近净值</Text>
            {recent.length === 0 ? <Text style={styles.meta}>暂无净值</Text> : recent.map((row) => <NavRow key={row.price_date} row={row} />)}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Stat({ label, text, value, plain = false }: { label: string; text: string; value: number | null; plain?: boolean }) {
  return (
    <View style={styles.stat}>
      {plain ? <Text style={styles.plain}>{text}</Text> : <ReturnText text={text} value={value} size={16} />}
      <Text style={styles.meta}>{label}</Text>
    </View>
  )
}

function NavRow({ row }: { row: NavPoint }) {
  const change = fmtPercentPoints(row.price_change)
  return (
    <View style={styles.navRow}>
      <Text style={styles.navDate}>{fmtDate(row.price_date)}</Text>
      <Text style={styles.navValue}>{fmtNav(row.nav)}</Text>
      <Text style={[styles.navChange, { color: returnColor(change.n) }]}>{change.text}</Text>
    </View>
  )
}

function buildChart(rows: NavPoint[]): { date: string; value: number }[] {
  const points = rows
    .map((row) => {
      const raw = parseNum(row.cumulative_nav) ?? parseNum(row.cum_nav_withdrawal) ?? parseNum(row.nav)
      if (raw == null || raw <= 0) return null
      return { date: row.price_date.slice(0, 10), value: raw }
    })
    .filter((point): point is { date: string; value: number } => point != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (points.length === 0) return []
  const base = points[0].value
  const indexed = points.map((point) => ({ date: point.date, value: (point.value / base - 1) * 100 }))
  return downsample(indexed, 180)
}

function downsample(rows: { date: string; value: number }[], max: number) {
  if (rows.length <= max) return rows
  const step = (rows.length - 1) / (max - 1)
  const out: { date: string; value: number }[] = []
  for (let i = 0; i < max; i += 1) out.push(rows[Math.round(i * step)])
  return out
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 36, gap: 18 },
  kicker: { color: colors.gold, fontSize: 12, letterSpacing: 1.2, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, lineHeight: 34, letterSpacing: -0.3 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger },
  center: { padding: 24, gap: 12 },
  retry: { alignSelf: "flex-start", backgroundColor: colors.ink, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: colors.bg, fontWeight: "700" },
  hero: { paddingTop: 8, paddingBottom: 4, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  heroValue: { fontSize: 40, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"], letterSpacing: -0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  stat: { width: "50%", paddingVertical: 12, paddingRight: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  plain: { fontSize: 18, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  card: { gap: 10, paddingTop: 4 },
  section: { fontSize: 13, fontWeight: "700", color: colors.text, letterSpacing: 1 },
  navRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  navDate: { flex: 1, color: colors.muted, fontSize: 13 },
  navValue: { width: 90, textAlign: "right", color: colors.text, fontVariant: ["tabular-nums"] },
  navChange: { width: 78, textAlign: "right", fontWeight: "700", fontVariant: ["tabular-nums"] },
})
