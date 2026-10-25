import { Redirect, useRouter } from "expo-router"
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
import { useAuth } from "@/auth"
import { canAccessPfInvestmentPool } from "@/permissions"
import { fetchMomUnderlying } from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { ReturnText } from "@/components/ReturnText"
import { displayFundName, fmtDate, fmtNav, fmtRatioPct } from "@/format"
import type { MomUnderlyingRow } from "@/types"
import { colors, returnBg } from "@/theme"

type Props = { onBack?: () => void }

export default function MomUnderlyingScreen({ onBack }: Props) {
  const { user } = useAuth()
  if (!canAccessPfInvestmentPool(user)) return <Redirect href="/private-funds" />

  const router = useRouter()
  const [keyword, setKeyword] = useState("")
  const [rows, setRows] = useState<MomUnderlyingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    const result = await fetchMomUnderlying()
    setRows(result.data)
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
      const blob = [row.product_name, row.beian_hao, row.account, row.strategy, row.note]
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
              <Text style={styles.title}>MOM底层</Text>
            </View>
          </View>
          <Text style={styles.count}>{filtered.length > 0 ? `${filtered.length}` : ""}</Text>
        </View>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索名称、备案号或账户"
          placeholderTextColor="#A39E96"
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.id || item.account || item.beian_hao}-${index}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.up} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : styles.list}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
            ) : error ? (
              <View />
            ) : (
              <Text style={styles.empty}>没有匹配的MOM底层产品</Text>
            )
          }
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

function FundRow({ item, onPress }: { item: MomUnderlyingRow; onPress: () => void }) {
  const day = fmtRatioPct(item.latest_price_change)
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={2}>{displayFundName(item.product_name)}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.beian_hao || "无备案号"}
          {item.account ? `  ·  ${item.account}` : ""}
          {item.strategy ? `  ·  ${item.strategy}` : ""}
        </Text>
        <Text style={styles.navLine}>{fmtNav(item.latest_nav)}  ·  {fmtDate(item.latest_nav_date)}</Text>
      </View>
      <View style={[styles.returnBox, { backgroundColor: returnBg(day.n) }]}>
        <ReturnText text={day.text} value={day.n} size={15} />
        <Text style={styles.returnLabel}>当日</Text>
      </View>
    </Pressable>
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
})
