import { useRouter } from "expo-router"
import { createElement, useEffect, useState } from "react"
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchSiteProfile } from "@/api"
import { getSession } from "@/session"
import { colors } from "@/theme"

export default function MomBriefingScreen() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const user = await fetchSiteProfile()
        const payload = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
        }
        const next = `${getSession().baseUrl}/open-mom-briefing#${encodeURIComponent(JSON.stringify(payload))}`
        if (cancelled) return
        if (Platform.OS === "web") setUrl(next)
        else await Linking.openURL(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "简报打开失败")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.replace("/mom/daily")} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>MOM 简报</Text>
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : url ? (
        <View style={styles.frame}>
          {Platform.OS === "web" ? <WebFrame url={url} /> : <Text style={styles.hint}>已在浏览器中打开，可用页面上的按钮下载 PDF、图片或 HTML。</Text>}
        </View>
      ) : (
        <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
      )}
    </SafeAreaView>
  )
}

function WebFrame({ url }: { url: string }) {
  return createElement("iframe", {
    title: "MOM 简报",
    src: url,
    style: { flex: 1, width: "100%", height: "100%", border: "none", background: "#f3f0ea" },
  })
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 10,
  },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  frame: { flex: 1 },
  error: { color: colors.danger, marginHorizontal: 22, marginTop: 16, lineHeight: 20 },
  hint: { color: colors.muted, marginHorizontal: 22, marginTop: 16, lineHeight: 20 },
})
