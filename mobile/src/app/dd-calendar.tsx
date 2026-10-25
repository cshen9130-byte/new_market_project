import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchDueDiligenceSchedules } from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import type { DueDiligenceSchedule } from "@/types"
import { colors } from "@/theme"

type Props = { onBack?: () => void }

export default function DdCalendarScreen({ onBack }: Props) {
  const [keyword, setKeyword] = useState("")
  const [rows, setRows] = useState<DueDiligenceSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    const list = await fetchDueDiligenceSchedules()
    const sorted = [...list].sort((a, b) => {
      const ka = `${a.startDate || ""} ${a.startTime || ""}`
      const kb = `${b.startDate || ""} ${b.startTime || ""}`
      return kb.localeCompare(ka)
    })
    setRows(sorted)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch((err: unknown) => {
        if (!cancelled) {
          setRows([])
          setError(err instanceof Error ? err.message : "加载失败")
        }
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

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const blob = [row.title, row.institution, row.target, row.personnel, row.recommender, row.description]
        .map((part) => String(part || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }, [rows, keyword])

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardSafe>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {onBack ? (
              <Pressable onPress={onBack} hitSlop={12}>
                <Text style={styles.back}>返回</Text>
              </Pressable>
            ) : null}
            <View>
              <Text style={styles.eyebrow}>投资</Text>
              <Text style={styles.title}>尽调日历</Text>
            </View>
          </View>
          <Text style={styles.count}>{filtered.length > 0 ? `${filtered.length}` : ""}</Text>
        </View>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索标题、机构或标的"
          placeholderTextColor="#A39E96"
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.up} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : styles.list}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
            ) : error ? (
              <View />
            ) : (
              <Text style={styles.empty}>暂无尽调安排</Text>
            )
          }
          renderItem={({ item }) => <ScheduleRow item={item} />}
        />
      </KeyboardSafe>
    </SafeAreaView>
  )
}

function ScheduleRow({ item }: { item: DueDiligenceSchedule }) {
  const method = item.method === "onsite" ? "线下" : item.method === "online" ? "线上" : String(item.method || "")
  const ddType = item.ddType === "followup" ? "回访" : item.ddType === "first" ? "初调" : String(item.ddType || "")
  const time = item.allDay
    ? "全天"
    : `${item.startTime || ""}${item.endTime ? `-${item.endTime}` : ""}`.trim()
  return (
    <View style={styles.row}>
      <View style={styles.dateBox}>
        <Text style={styles.dateDay}>{String(item.startDate || "").slice(5) || "--"}</Text>
        <Text style={styles.dateYear}>{String(item.startDate || "").slice(0, 4)}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={2}>{item.title || "未命名安排"}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[time, method, ddType].filter(Boolean).join("  ·  ")}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[item.institution, item.target, item.personnel].filter(Boolean).join("  ·  ") || "—"}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 22, paddingTop: 8 },
  headerLeft: { gap: 8 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  count: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  search: {
    marginHorizontal: 22,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, marginHorizontal: 22, marginTop: 8 },
  list: { paddingBottom: 16 },
  emptyWrap: { flexGrow: 1 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 56 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dateBox: { width: 54, alignItems: "center", paddingTop: 2 },
  dateDay: { color: colors.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  dateYear: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowMain: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
})
