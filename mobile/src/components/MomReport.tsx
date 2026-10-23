import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchMomOverview, type MomOverview, type MomRow, type MomSource } from "@/api"
import { NavChart } from "@/components/NavChart"
import { colors, returnColor } from "@/theme"

type Panel = "days" | "sectors" | "products" | "accounts"

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "days", label: "近日" },
  { id: "sectors", label: "板块" },
  { id: "products", label: "品种" },
  { id: "accounts", label: "账户" },
]

function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 10000) {
    const wan = abs / 10000
    const digits = wan >= 100 ? 1 : 2
    return `${sign}${wan.toFixed(digits)}万`
  }
  const body = Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${sign}${body}`
}

function signedPct(value: number): string {
  const pct = value * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(2)}%`
}

function capital(value: number): string {
  const body = Math.abs(Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return value < 0 ? `-${body}` : body
}

export function MomReport({ source, title }: { source: MomSource; title: string }) {
  const router = useRouter()
  const [data, setData] = useState<MomOverview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [panel, setPanel] = useState<Panel>("sectors")

  const load = useCallback(async () => {
    const next = await fetchMomOverview(source)
    setData(next)
    setError("")
  }, [source])

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

  const rows = rowsFor(data, panel)
  const panelDate = dateFor(data, panel)
  const empty = source === "account" ? "还没有单账户核算数据" : "还没有 MOM 核算数据"

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.replace("/mom")} hitSlop={12}>
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
          <Text style={styles.kicker}>每日风控</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{data?.date || "还没有核算日期"}</Text>
          {source === "mom" ? (
            <Pressable style={styles.briefing} onPress={() => router.push("/mom/briefing")}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.briefingName}>MOM 简报</Text>
                <Text style={styles.meta}>在手机里查看和电脑版相同的简报。</Text>
              </View>
              <Text style={styles.briefingGo}>查看</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.hero}>
            <Text style={[styles.heroValue, { color: returnColor(data?.pnl ?? null) }]}>
              {data?.pnl == null ? "—" : money(data.pnl)}
            </Text>
            <Text style={styles.meta}>组合当日盈亏</Text>
          </View>

          <View style={styles.grid}>
            <Stat label="净值" text={data?.nav == null ? "—" : data.nav.toFixed(4)} />
            <Stat
              label="当日收益"
              text={data?.dailyReturn == null ? "—" : signedPct(data.dailyReturn)}
              tone={data?.dailyReturn ?? null}
            />
            <Stat
              label="当年累计"
              text={data?.ytdReturn == null ? "—" : signedPct(data.ytdReturn)}
              tone={data?.ytdReturn ?? null}
            />
            <Stat label="累计资金" text={data?.cumCapital == null ? "—" : capital(data.cumCapital)} />
            <Stat
              label={source === "account" ? "账户" : "子账户"}
              text={
                data?.subAccountCount == null
                  ? "—"
                  : data.emptyAccountCount
                    ? `${data.subAccountCount} · 空仓 ${data.emptyAccountCount}`
                    : String(data.subAccountCount)
              }
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>净值走势</Text>
            <NavChart points={data?.curve ?? []} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {PANELS.map((item) => {
              const on = item.id === panel
              return (
                <Pressable key={item.id} onPress={() => setPanel(item.id)} style={styles.chip}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
                  <View style={[styles.chipMark, on && styles.chipMarkOn]} />
                </Pressable>
              )
            })}
          </ScrollView>
          {panelDate && panel !== "days" ? <Text style={styles.meta}>{panelDate}</Text> : null}

          {rows.length === 0 ? (
            <Text style={styles.empty}>{data?.date ? "这一天没有盈亏" : empty}</Text>
          ) : (
            rows.map((row) => (
              <View key={`${panel}-${row.name}`} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                <Text style={[styles.pnl, { color: returnColor(row.pnl) }]}>{money(row.pnl)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function rowsFor(data: MomOverview | null, panel: Panel): MomRow[] {
  if (!data) return []
  if (panel === "days") return data.days.map((row) => ({ name: row.date, pnl: row.pnl }))
  if (panel === "sectors") return data.sectors
  if (panel === "products") return data.products
  return data.accounts
}

function dateFor(data: MomOverview | null, panel: Panel): string | null {
  if (!data) return null
  if (panel === "accounts") return data.accountDate
  if (panel === "sectors" || panel === "products") return data.sectorDate
  return data.date
}

function Stat({ label, text, tone = null }: { label: string; text: string; tone?: number | null }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone != null ? { color: returnColor(tone) } : null]}>{text}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 36 },
  kicker: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4, marginTop: 2 },
  briefing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  briefingName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  briefingGo: { color: colors.gold, fontSize: 12, letterSpacing: 1, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger, marginTop: 8 },
  center: { paddingHorizontal: 22, paddingTop: 24, gap: 12 },
  retry: { alignSelf: "flex-start", backgroundColor: colors.ink, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: colors.bg, fontWeight: "700" },
  hero: { paddingTop: 18, paddingBottom: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  heroValue: { fontSize: 40, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: -0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  stat: { width: "50%", paddingVertical: 12, paddingRight: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  statValue: { fontSize: 16, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  card: { gap: 8, paddingTop: 18 },
  section: { fontSize: 13, fontWeight: "700", color: colors.text, letterSpacing: 1 },
  chips: { paddingTop: 8, gap: 18 },
  chip: { paddingTop: 10, paddingBottom: 8, alignItems: "center" },
  chipText: { color: colors.muted, fontSize: 14 },
  chipTextOn: { color: colors.text, fontWeight: "700" },
  chipMark: { marginTop: 8, height: 2, width: "100%", backgroundColor: "transparent" },
  chipMarkOn: { backgroundColor: colors.gold },
  empty: { color: colors.muted, marginTop: 28 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  pnl: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
})
