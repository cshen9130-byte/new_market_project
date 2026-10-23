import { useRouter } from "expo-router"
import { createElement, useEffect, useRef, useState, type ComponentType, type RefObject } from "react"
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { WebView } from "react-native-webview"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchSiteProfile } from "@/api"
import { getSession } from "@/session"
import { createBriefingShareCollector, shareBriefingImage, shareBriefingScript } from "@/share-briefing"
import { colors } from "@/theme"

export default function MomBriefingScreen() {
  const router = useRouter()
  const webRef = useRef<WebView>(null)
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState("")
  const onShareMessage = useRef(
    createBriefingShareCollector(
      (base64, mime) => {
        void shareBriefingImage(base64, mime)
          .then(() => {
            setSharing(false)
            setShareNote("")
          })
          .catch((err: unknown) => {
            setSharing(false)
            setShareNote(err instanceof Error ? err.message : "分享失败")
          })
      },
      (message) => {
        setSharing(false)
        setShareNote(message)
      },
    ),
  ).current

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
        if (!cancelled) setUrl(next)
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
        <Pressable
          style={styles.share}
          disabled={sharing || !url}
          onPress={() => {
            if (Platform.OS === "web") {
              setShareNote("请在手机 App 里分享到微信")
              return
            }
            setSharing(true)
            setShareNote("正在生成简报图片…")
            webRef.current?.injectJavaScript(shareBriefingScript())
          }}
        >
          <Text style={styles.shareText}>{sharing ? "生成中" : "分享"}</Text>
        </Pressable>
      </View>
      {shareNote ? <Text style={styles.note}>{shareNote}</Text> : null}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : url ? (
        <View style={styles.frame}>
          {Platform.OS === "web" ? <WebFrame url={url} /> : <NativeFrame url={url} webRef={webRef} onMessage={onShareMessage} />}
        </View>
      ) : (
        <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
      )}
    </SafeAreaView>
  )
}

function NativeFrame({
  url,
  webRef,
  onMessage,
}: {
  url: string
  webRef: RefObject<WebView | null>
  onMessage: (raw: string) => void
}) {
  const Frame = WebView as unknown as ComponentType<{
    ref?: RefObject<WebView | null>
    source: { uri: string }
    style: { flex: number; backgroundColor: string }
    setSupportMultipleWindows: boolean
    originWhitelist: string[]
    javaScriptEnabled: boolean
    domStorageEnabled: boolean
    mixedContentMode: "always"
    onMessage: (event: { nativeEvent: { data: string } }) => void
  }>
  return (
    <Frame
      ref={webRef}
      source={{ uri: url }}
      style={{ flex: 1, backgroundColor: "#0f1520" }}
      setSupportMultipleWindows={false}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={(event) => onMessage(event.nativeEvent.data)}
    />
  )
}

function WebFrame({ url }: { url: string }) {
  return createElement("iframe", {
    title: "MOM 简报",
    src: url,
    // Block new tabs and navigation of the phone preview itself.
    sandbox: "allow-same-origin allow-scripts allow-forms allow-downloads",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      border: "none",
      background: "#0f1520",
    },
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
  title: { color: colors.text, fontSize: 18, fontWeight: "700", flex: 1 },
  share: {
    marginLeft: "auto",
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shareText: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 12, paddingHorizontal: 22, paddingBottom: 8 },
  frame: { flex: 1, position: "relative" },
  error: { color: colors.danger, marginHorizontal: 22, marginTop: 16, lineHeight: 20 },
})
