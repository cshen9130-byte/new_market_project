import { Redirect, useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
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
import { useAuth } from "@/auth"
import { canAccessPfInvestmentPool } from "@/permissions"
import { fetchManagedProducts } from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { ReturnText } from "@/components/ReturnText"
import { displayFundName, fmtDate, fmtNav, fmtRatioPct, strategyLine } from "@/format"
import type { ManagedProduct } from "@/types"
import { colors, returnBg } from "@/theme"

type Props = {
  onBack?: () => void
}

export default function ManagedProductsScreen({ onBack }: Props) {
  const { user } = useAuth()
  if (!canAccessPfInvestmentPool(user)) return <Redirect href="/private-funds" />

  const router = useRouter()
  const [keyword, setKeyword] = useState("")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<ManagedProduct[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async (nextPage: number, mode: "replace" | "append") => {
    if (mode === "replace") setError("")
    const result = await fetchManagedProducts({ page: nextPage, keyword: query })
    setPage(result.page)
    setTotal(result.total)
    setTotalPages(result.totalPages)
    setRows((current) => (mode === "append" ? dedupe([...current, ...result.data]) : result.data))
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(keyword.trim()), 350)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load(1, "replace")
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
      await load(1, "replace")
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setRefreshing(false)
    }
  }

  async function onEnd() {
    if (loading || loadingMore || refreshing || page >= totalPages) return
    setLoadingMore(true)
    try {
      await load(page + 1, "append")
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoadingMore(false)
    }
  }

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
            <Text style={styles.title}>在管产品</Text>
          </View>
        </View>
        <Text style={styles.count}>{total > 0 ? `${total}` : ""}</Text>
      </View>
      <TextInput
        value={keyword}
        onChangeText={setKeyword}
        placeholder="搜索名称或备案号"
        placeholderTextColor="#A39E96"
        style={styles.search}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item, index) => `${item.beian_hao || item.product_name}-${index}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.up} />}
        contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.list}
        onEndReached={onEnd}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
          ) : error ? (
            <View />
          ) : (
            <Text style={styles.empty}>暂无匹配的在管产品</Text>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.up} style={{ marginVertical: 16 }} /> : <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <FundRow
            item={item}
            onPress={() => item.beian_hao && router.push(`/fund/${encodeURIComponent(item.beian_hao)}`)}
          />
        )}
      />
      </KeyboardSafe>
    </SafeAreaView>
  )
}

function FundRow({ item, onPress }: { item: ManagedProduct; onPress: () => void }) {
  const day = fmtRatioPct(item.latest_price_change)
  const month = fmtRatioPct(item.ret_1m)
  const strategy = strategyLine([item.strategy_l1, item.strategy_l2])
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={2}>{displayFundName(item.product_name, item.short_name)}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.beian_hao || "无备案号"}
          {strategy ? `  ·  ${strategy}` : ""}
        </Text>
        <Text style={styles.navLine}>{fmtNav(item.latest_nav)}  ·  {fmtDate(item.latest_nav_date)}</Text>
      </View>
      <View style={[styles.returnBox, { backgroundColor: returnBg(month.n) }]}>
        <ReturnText text={month.text} value={month.n} size={15} />
        <Text style={styles.returnLabel}>近一月</Text>
        <Text style={styles.dayLine}>{day.text}</Text>
      </View>
    </Pressable>
  )
}

function dedupe(rows: ManagedProduct[]): ManagedProduct[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = row.beian_hao || row.product_name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 12 },
  navLine: { color: colors.text, fontSize: 12, marginTop: 4, fontVariant: ["tabular-nums"] },
  returnBox: { width: 84, alignItems: "flex-end", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 8 },
  returnLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  dayLine: { color: colors.muted, fontSize: 11, marginTop: 2, fontVariant: ["tabular-nums"] },
})
