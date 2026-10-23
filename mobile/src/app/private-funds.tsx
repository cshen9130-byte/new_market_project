import { useState } from "react"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import SearchScreen from "@/app/(tabs)/search"
import TrackingScreen from "@/app/(tabs)/tracking"
import { colors } from "@/theme"
import { useStepBack } from "@/use-step-back"

export default function PrivateFundsScreen() {
  const router = useRouter()
  const [page, setPage] = useState<"menu" | "tracking" | "search">("menu")
  useStepBack(page !== "menu", () => setPage("menu"))
  if (page === "tracking") return <TrackingScreen onBack={() => setPage("menu")} />
  if (page === "search") return <SearchScreen onBack={() => setPage("menu")} />
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>模块</Text>
        <Text style={styles.title}>私募基金</Text>
        <Text style={styles.lead}>跟踪池里的产品和全库搜索都在这里。</Text>
        <Pressable style={styles.row} onPress={() => setPage("tracking")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>跟踪产品</Text>
            <Text style={styles.detail}>按池查看净值、近一月和当日涨跌</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setPage("search")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>搜索基金</Text>
            <Text style={styles.detail}>按名称、备案号或管理人打开净值</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingTop: 18 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4, marginTop: 2 },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowMain: { flex: 1, gap: 4 },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  go: { color: colors.gold, fontSize: 12, letterSpacing: 1, fontWeight: "700" },
})
