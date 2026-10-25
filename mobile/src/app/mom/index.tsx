import { Redirect, useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/auth"
import { canAccessMom } from "@/permissions"
import { colors } from "@/theme"

const ITEMS = [
  {
    title: "MOM 每日风控",
    detail: "查看新版 MOM 风控报告。",
    href: "/mom/daily",
  },
  {
    title: "单账户每日风控",
    detail: "查看单账户每日风控报告。",
    href: "/mom/account",
  },
] as const

export default function MomHome() {
  const { user } = useAuth()
  if (!canAccessMom(user)) return <Redirect href="/(tabs)/home" />

  const router = useRouter()
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/home") }} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>MOM分析</Text>
        <Text style={styles.lead}>月度绩效分析与归因。</Text>
        {ITEMS.map((item) => (
          <Pressable key={item.href} style={styles.row} onPress={() => router.push(item.href)}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{item.title}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </View>
            <Text style={styles.go}>进入</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingTop: 18 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
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
