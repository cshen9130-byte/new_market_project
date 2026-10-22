import { Redirect, useLocalSearchParams, useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { colors } from "@/theme"

const TITLES: Record<string, string> = {
  mom: "MOM分析",
}

export default function EmptyModuleScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id || ""
  if (id === "mom") return <Redirect href="/mom" />
  const title = TITLES[id] || "模块"
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>模块</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.lead}>这一页先留空。你定好做法之后，再接到手机上。</Text>
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
  lead: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 12 },
})
