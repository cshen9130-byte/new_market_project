import { useEffect } from "react"
import { useRouter } from "expo-router"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { colors } from "@/theme"

/**
 * Legacy full-page AI chat route.
 * Primary UX is hold-to-talk on the tab-bar AI ball + overlay.
 * Keep this route as a soft redirect so old deep links do not break.
 */
export default function AiChatScreen() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/(tabs)/home")
  }, [router])

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.gold} />
      <Text style={styles.hint}>请长按底栏 AI 球说话</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  hint: { color: colors.muted, fontSize: 14, letterSpacing: 0.6 },
})
