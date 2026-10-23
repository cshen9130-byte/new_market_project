import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { searchFunds } from "@/api"
import { displayFundName } from "@/format"
import type { SearchManager, SearchProduct } from "@/types"
import { colors } from "@/theme"

export default function SearchScreen({ onBack }: { onBack?: () => void }) {
  const router = useRouter()
  const [keyword, setKeyword] = useState("")
  const [products, setProducts] = useState<SearchProduct[]>([])
  const [managers, setManagers] = useState<SearchManager[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const q = keyword.trim()
    if (!q) {
      setProducts([])
      setManagers([])
      setError("")
      setSearched(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError("")
      searchFunds(q)
        .then((result) => {
          if (cancelled) return
          setProducts(result.products)
          setManagers(result.managers)
          setSearched(true)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setProducts([])
          setManagers([])
          setError(err instanceof Error ? err.message : "搜索失败")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [keyword])

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.backHit}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      ) : null}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>检索</Text>
        <Text style={styles.title}>搜索</Text>
      </View>
      <TextInput
        value={keyword}
        onChangeText={setKeyword}
        placeholder="基金名称、备案号或管理人"
        placeholderTextColor="#A39E96"
        style={styles.search}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={colors.up} style={{ marginTop: 24 }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!keyword.trim() ? <Text style={styles.hint}>输入产品名称或备案号，打开净值和收益。</Text> : null}
        {managers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>管理人</Text>
            {managers.map((manager) => (
              <Pressable key={manager.registration_no} style={styles.row} onPress={() => setKeyword(manager.manager_name)}>
                <Text style={styles.name}>{manager.manager_name}</Text>
                <Text style={styles.meta}>{manager.registration_no}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {products.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>产品</Text>
            {products.map((product) => (
              <Pressable
                key={product.beian_hao}
                style={styles.row}
                onPress={() => router.push(`/fund/${encodeURIComponent(product.beian_hao)}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{displayFundName(product.product_name, product.short_name)}</Text>
                  <Text style={styles.meta}>{product.beian_hao}{product.strategy_one ? `  ·  ${product.strategy_one}` : ""}</Text>
                </View>
                {product.has_nav == null ? null : (
                  <Text style={[styles.badge, product.has_nav ? styles.badgeOn : styles.badgeOff]}>
                    {product.has_nav ? "有净值" : "无净值"}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        ) : null}
        {searched && !loading && !error && products.length === 0 && managers.length === 0 ? (
          <Text style={styles.hint}>没有找到匹配的产品或管理人</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  backHit: { paddingHorizontal: 22, paddingTop: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  header: { paddingHorizontal: 22, paddingTop: 8 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  search: {
    marginHorizontal: 22,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  body: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32, gap: 18 },
  hint: { color: colors.muted, lineHeight: 22, marginTop: 8 },
  error: { color: colors.danger },
  section: { gap: 0 },
  sectionTitle: { color: colors.gold, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  badge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  badgeOn: { color: colors.up },
  badgeOff: { color: colors.muted },
})
