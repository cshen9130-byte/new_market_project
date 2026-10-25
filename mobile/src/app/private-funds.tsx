import { useMemo, useState } from "react"
import { useRouter } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import SearchScreen from "@/app/(tabs)/search"
import TrackingScreen from "@/app/(tabs)/tracking"
import ManagedProductsScreen from "@/app/managed-products"
import FofUnderlyingScreen from "@/app/fof-underlying"
import MomUnderlyingScreen from "@/app/mom-underlying"
import DdCalendarScreen from "@/app/dd-calendar"
import InvestmentNotesScreen from "@/app/investment-notes"
import FundReportsScreen from "@/app/fund-reports"
import { useAuth } from "@/auth"
import { canAccessPfInvestmentPool } from "@/permissions"
import { colors } from "@/theme"
import { useStepBack } from "@/use-step-back"

type Page = "menu" | "tracking" | "managed" | "fof" | "mom" | "dd" | "notes" | "reports" | "search"

export default function PrivateFundsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const showPool = canAccessPfInvestmentPool(user)
  const [page, setPage] = useState<Page>("menu")
  useStepBack(page !== "menu", () => setPage("menu"))

  const lead = useMemo(() => {
    const parts = ["跟踪池", "尽调日历", "投资笔记", "报告"]
    if (showPool) parts.push("在管产品", "FOF底层", "MOM底层")
    parts.push("全局搜索")
    return parts.join("、") + "可在这里。"
  }, [showPool])

  if (page === "tracking") return <TrackingScreen onBack={() => setPage("menu")} />
  if (page === "managed") {
    if (!showPool) return null
    return <ManagedProductsScreen onBack={() => setPage("menu")} />
  }
  if (page === "fof") {
    if (!showPool) return null
    return <FofUnderlyingScreen onBack={() => setPage("menu")} />
  }
  if (page === "mom") {
    if (!showPool) return null
    return <MomUnderlyingScreen onBack={() => setPage("menu")} />
  }
  if (page === "dd") return <DdCalendarScreen onBack={() => setPage("menu")} />
  if (page === "notes") return <InvestmentNotesScreen onBack={() => setPage("menu")} />
  if (page === "reports") return <FundReportsScreen onBack={() => setPage("menu")} />
  if (page === "search") return <SearchScreen onBack={() => setPage("menu")} />

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>模块</Text>
        <Text style={styles.title}>私募基金</Text>
        <Text style={styles.lead}>{lead}</Text>
        <Pressable style={styles.row} onPress={() => setPage("tracking")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>跟踪产品</Text>
            <Text style={styles.detail}>快速查看净值、近一月和当日涨跌</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setPage("dd")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>尽调日历</Text>
            <Text style={styles.detail}>行程与尽调安排，按时间浏览</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setPage("notes")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>投资笔记</Text>
            <Text style={styles.detail}>团队笔记列表，点开可看正文摘要</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setPage("reports")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>报告</Text>
            <Text style={styles.detail}>生成周报 / 月报 / 季报图片与 PDF，分享微信</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
        {showPool ? (
          <>
            <Pressable style={styles.row} onPress={() => setPage("managed")}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>在管产品</Text>
                <Text style={styles.detail}>投资池在管产品列表与净值</Text>
              </View>
              <Text style={styles.go}>进入</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => setPage("fof")}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>FOF底层</Text>
                <Text style={styles.detail}>FOF 底层持仓浏览</Text>
              </View>
              <Text style={styles.go}>进入</Text>
            </Pressable>
            <Pressable style={styles.row} onPress={() => setPage("mom")}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>MOM底层</Text>
                <Text style={styles.detail}>MOM 底层持仓浏览</Text>
              </View>
              <Text style={styles.go}>进入</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable style={styles.row} onPress={() => setPage("search")}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>全局搜索</Text>
            <Text style={styles.detail}>按管理人、产品名或备案号查找</Text>
          </View>
          <Text style={styles.go}>进入</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 8 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 40, gap: 10 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4, marginBottom: 4 },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flex: 1, gap: 4 },
  name: { fontSize: 17, fontWeight: "600", color: colors.text },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  go: { color: colors.gold, fontSize: 12, letterSpacing: 1, fontWeight: "700" },
})
