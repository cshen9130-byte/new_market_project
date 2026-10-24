import { useRouter } from "expo-router"
import { createElement, useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  BackHandler,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"
import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import { fetchSiteProfile } from "@/api"
import { getSession } from "@/session"
import { colors } from "@/theme"

const EMBED_HIDE_CHROME_JS = `
(function () {
  try {
    document.documentElement.setAttribute("data-mom-embed", "1");
    try { sessionStorage.setItem("momEmbedBriefing", "1"); } catch (e) {}
    var style = document.getElementById("__mom_embed_css");
    if (!style) {
      style = document.createElement("style");
      style.id = "__mom_embed_css";
      document.documentElement.appendChild(style);
    }
    // Hide every chrome layer above the MOM 风控简报 printable card.
    style.textContent = [
      "html[data-mom-embed='1'] header,",
      "html[data-mom-embed='1'] aside,",
      "html[data-mom-embed='1'] [data-sidebar],",
      "html[data-mom-embed='1'] nav[aria-label],",
      "html[data-mom-embed='1'] #section-top,",
      "html[data-mom-embed='1'] .mom-briefing-chrome,",
      "html[data-mom-embed='1'] .sticky.top-0.z-20.no-print,",
      "html[data-mom-embed='1'] .sticky.top-0.z-20 { display: none !important; }",
      "html[data-mom-embed='1'] body { background: #f3efe3 !important; }",
      "html[data-mom-embed='1'] #mom-briefing-printable { box-shadow: none !important; margin: 0 auto !important; }"
    ].join("\n");
    function hideFallbackNodes() {
      try {
        var roots = document.querySelectorAll("header, aside, #section-top, .mom-briefing-chrome, .sticky.top-0.z-20.no-print");
        for (var i = 0; i < roots.length; i++) {
          roots[i].style.setProperty("display", "none", "important");
        }
        // Download buttons bar: match by button labels if class selectors miss.
        var buttons = document.querySelectorAll("button");
        for (var j = 0; j < buttons.length; j++) {
          var t = (buttons[j].textContent || "").replace(/\s+/g, "");
          if (t.indexOf("\u4e0b\u8f7dPDF") >= 0 || t.indexOf("\u4e0b\u8f7d\u56fe\u7247") >= 0 || t.indexOf("\u4e0b\u8f7dHTML") >= 0) {
            var bar = buttons[j].closest("div.sticky, div.mom-briefing-chrome") || buttons[j].parentElement;
            if (bar) bar.style.setProperty("display", "none", "important");
          }
        }
      } catch (e) {}
    }
    hideFallbackNodes();
    if (!window.__momEmbedHideObserver) {
      window.__momEmbedHideObserver = new MutationObserver(function () { hideFallbackNodes(); });
      window.__momEmbedHideObserver.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () {
        try { window.__momEmbedHideObserver && window.__momEmbedHideObserver.disconnect(); } catch (e) {}
      }, 15000);
    }
  } catch (e) {}
  true;
})();
`

const CAPTURE_JS = `
(function () {
  function post(payload) {
    try {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }
  (async function () {
    try {
      var fn = window.__momBriefingCapturePng;
      if (typeof fn !== "function") {
        post({ type: "briefing-share-error", message: "简报尚未加载完成，请稍后再试" });
        return;
      }
      post({ type: "briefing-share-progress", message: "正在生成图片…" });
      var dataUrl = await fn();
      if (!dataUrl || typeof dataUrl !== "string" || dataUrl.indexOf("base64,") < 0) {
        post({ type: "briefing-share-error", message: "生成图片失败" });
        return;
      }
      post({ type: "briefing-share-png", data: dataUrl.split("base64,")[1] });
    } catch (err) {
      post({ type: "briefing-share-error", message: (err && err.message) || "分享失败" });
    }
  })();
  true;
})();
`

export default function MomBriefingScreen() {
  const router = useRouter()
  const webRef = useRef<any>(null)
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const baseUrl = getSession().baseUrl.replace(/\/$/, "")

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
        // open-mom-briefing redirects to risk-report?tab=briefing&embed=1
        const next = `${baseUrl}/open-mom-briefing#${encodeURIComponent(JSON.stringify(payload))}`
        if (cancelled) return
        setUrl(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "简报打开失败")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  function keepInWebView(requestUrl: string): boolean {
    const next = String(requestUrl || "")
    if (!next || next === "about:blank") return true
    if (/^https?:\/\//i.test(next)) return true
    return false
  }

  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearShareTimer = useCallback(() => {
    if (shareTimerRef.current) {
      clearTimeout(shareTimerRef.current)
      shareTimerRef.current = null
    }
  }, [])

  const onShare = useCallback(() => {
    if (sharing) return
    if (Platform.OS === "web") {
      Alert.alert("提示", "请在手机 App 内使用分享")
      return
    }
    setSharing(true)
    clearShareTimer()
    shareTimerRef.current = setTimeout(() => {
      setSharing(false)
      Alert.alert("分享超时", "生成图片时间过长，请等简报完全加载后再试")
    }, 45000)
    webRef.current?.injectJavaScript(CAPTURE_JS)
  }, [sharing, clearShareTimer])

  async function sharePngBase64(base64: string) {
    try {
      const dir = FileSystem.cacheDirectory
      if (!dir) throw new Error("无法写入临时文件")
      const path = `${dir}mom-briefing-share.png`
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const canShare = await Sharing.isAvailableAsync()
      if (!canShare) throw new Error("当前系统不支持分享")
      await Sharing.shareAsync(path, {
        mimeType: "image/png",
        dialogTitle: "分享 MOM 简报",
        UTI: "public.png",
      })
    } finally {
      clearShareTimer()
      setSharing(false)
    }
  }

  function onMessage(event: { nativeEvent: { data: string } }) {
    let payload: { type?: string; data?: string; message?: string } = {}
    try {
      payload = JSON.parse(String(event.nativeEvent.data || "{}"))
    } catch {
      return
    }
    if (payload.type === "briefing-share-progress") {
      return
    }
    if (payload.type === "briefing-share-error") {
      clearShareTimer()
      setSharing(false)
      Alert.alert("分享失败", payload.message || "请稍后重试")
      return
    }
    if (payload.type === "briefing-share-png" && payload.data) {
      void sharePngBase64(payload.data).catch((err: unknown) => {
        setSharing(false)
        Alert.alert("分享失败", err instanceof Error ? err.message : "请稍后重试")
      })
    }
  }


  const onNavBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace("/mom/daily")
  }, [router])

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const web = webRef.current
      if (web && typeof web.canGoBack === "function" && web.canGoBack()) {
        web.goBack()
        return true
      }
      if (router.canGoBack()) {
        router.back()
        return true
      }
      router.replace("/mom/daily")
      return true
    })
    return () => sub.remove()
  }, [router])

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={onNavBack} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>MOM 简报</Text>
        <View style={styles.topRight}>
          <Pressable
            onPress={onShare}
            disabled={sharing || !url || !!error}
            hitSlop={12}
            style={styles.shareBtn}
          >
            {sharing ? (
              <ActivityIndicator color={colors.gold} size="small" />
            ) : (
              <Text style={styles.share}>分享</Text>
            )}
          </Pressable>
        </View>
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : url ? (
        <View style={styles.frame}>
          {Platform.OS === "web" ? (
            <WebFrame url={url} />
          ) : (
            <>
              {loading ? <ActivityIndicator color={colors.up} style={styles.loader} /> : null}
              <WebView
                ref={webRef}
                source={{ uri: url }}
                style={styles.webview}
                onLoadEnd={() => {
                  setLoading(false)
                  webRef.current?.injectJavaScript(EMBED_HIDE_CHROME_JS)
                  // Re-apply after React paints dashboard chrome on the redirected page.
                  ;[200, 800, 1600].forEach((ms) => {
                    setTimeout(() => webRef.current?.injectJavaScript(EMBED_HIDE_CHROME_JS), ms)
                  })
                }}
                onError={() => {
                  setLoading(false)
                  setError("简报页面加载失败，请检查网络后重试。")
                }}
                onShouldStartLoadWithRequest={(req: { url: string }) => keepInWebView(req.url)}
                onOpenWindow={(event: { nativeEvent?: { targetUrl?: string } }) => {
                  const target = String(event?.nativeEvent?.targetUrl || "")
                  if (target && /^https?:\/\//i.test(target)) {
                    webRef.current?.injectJavaScript(
                      `window.location.href=${JSON.stringify(target)};true;`,
                    )
                  }
                }}
                onMessage={onMessage}
                injectedJavaScript={EMBED_HIDE_CHROME_JS}
                setSupportMultipleWindows={false}
                javaScriptCanOpenWindowsAutomatically={false}
                startInLoadingState
                allowsBackForwardNavigationGestures={false}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                originWhitelist={["*"]}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
              />
            </>
          )}
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
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 10,
  },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "700" },
  topRight: { minWidth: 48, alignItems: "flex-end" },
  shareBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  share: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  frame: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.bg },
  loader: { position: "absolute", top: 40, alignSelf: "center", zIndex: 2 },
  error: { color: colors.danger, marginHorizontal: 22, marginTop: 16, lineHeight: 20 },
})
