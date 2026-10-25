import { ActivityIndicator, Platform, StatusBar as RNStatusBar, View } from "react-native"
import { useEffect, type ReactNode } from "react"
import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AuthProvider, useAuth } from "@/auth"
import { promptAppUpdate } from "@/app-update"
import { colors } from "@/theme"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { setLastBootTag, clearLastBootTag, getLastBootTag } from "@/crash-boot"
import { ENABLE_HOME_DARK_STATUS } from "@/feature-flags"

function WebPhoneShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return
    const html = document.documentElement
    const body = document.body
    const root = document.getElementById("root")
    const prev = {
      htmlHeight: html.style.height,
      bodyHeight: body.style.height,
      bodyMargin: body.style.margin,
      bodyBg: body.style.background,
      rootMaxWidth: root?.style.maxWidth ?? "",
      rootMargin: root?.style.margin ?? "",
      rootHeight: root?.style.height ?? "",
      rootWidth: root?.style.width ?? "",
      rootShadow: root?.style.boxShadow ?? "",
      rootRadius: root?.style.borderRadius ?? "",
      rootOverflow: root?.style.overflow ?? "",
    }
    html.style.height = "100%"
    body.style.height = "100%"
    body.style.margin = "0"
    body.style.background = "#111827"
    if (root) {
      root.style.maxWidth = "390px"
      root.style.width = "100%"
      root.style.margin = "0 auto"
      root.style.height = "100%"
      root.style.boxShadow = "0 24px 70px rgba(0,0,0,0.45)"
      root.style.borderRadius = "24px"
      root.style.overflow = "hidden"
    }
    return () => {
      html.style.height = prev.htmlHeight
      body.style.height = prev.bodyHeight
      body.style.margin = prev.bodyMargin
      body.style.background = prev.bodyBg
      if (root) {
        root.style.maxWidth = prev.rootMaxWidth
        root.style.margin = prev.rootMargin
        root.style.height = prev.rootHeight
        root.style.width = prev.rootWidth
        root.style.boxShadow = prev.rootShadow
        root.style.borderRadius = prev.rootRadius
        root.style.overflow = prev.rootOverflow
      }
    }
  }, [])
  if (Platform.OS !== "web") return <>{children}</>
  return (
    <View style={{ flex: 1, backgroundColor: "#111827", alignItems: "center" }}>
      <View style={{ width: 390, maxWidth: "100%", flex: 1, backgroundColor: colors.bg, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  )
}

export default function RootLayout() {
  return (
    <WebPhoneShell>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <ErrorBoundary featureTag="root">
              <AuthGate />
            </ErrorBoundary>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </WebPhoneShell>
  )
}

function AuthGate() {
  const { ready, user } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const onHome = segments[0] === "(tabs)" && (segments as string[])[1] === "home"

  useEffect(() => {
    if (!ready) return
    const onLogin = segments[0] === "login"
    if (!user && !onLogin) router.replace("/login")
    if (user && onLogin) router.replace("/(tabs)/home")
  }, [ready, user, segments, router])


  useEffect(() => {
    void (async () => {
      const prev = await getLastBootTag()
      if (prev) console.warn("[boot] previous lastBootTag", prev)
      await setLastBootTag(
        ENABLE_HOME_DARK_STATUS ? "layout:AuthGate:mount+statusFlag" : "layout:AuthGate:mount",
      )
    })()
    const g = globalThis as typeof globalThis & {
      ErrorUtils?: {
        getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined
        setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void
      }
    }
    const eu = g.ErrorUtils
    const prevHandler = eu?.getGlobalHandler?.()
    eu?.setGlobalHandler?.((error, isFatal) => {
      console.error("[globalJS]", isFatal ? "fatal" : "nonfatal", error?.message)
      void setLastBootTag(`js:${isFatal ? "fatal" : "err"}:${(error?.message || "unknown").slice(0, 80)}`)
      prevHandler?.(error, isFatal)
    })
    return () => {
      void clearLastBootTag()
      if (prevHandler) eu?.setGlobalHandler?.(prevHandler)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    void setLastBootTag(ENABLE_HOME_DARK_STATUS ? "layout:ready+statusFlag" : "layout:ready")
    void promptAppUpdate(false)
  }, [ready])

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        {ENABLE_HOME_DARK_STATUS && Platform.OS === "android" ? (
          <RNStatusBar barStyle="dark-content" backgroundColor="#F3F0EA" translucent={false} />
        ) : (
          <StatusBar style="dark" />
        )}
        <ActivityIndicator color={colors.up} />
      </View>
    )
  }

  // 1.6.45: theme statusBarColor is OPAQUE (#F3F0EA). On home, paint opaque #12100E
  // + light icons (translucent failed on Huawei — white strip + white icons).
  return (
    <>
      {ENABLE_HOME_DARK_STATUS && Platform.OS === "android" ? (
        <RNStatusBar
          animated
          barStyle="light-content"
          backgroundColor="#12100E"
          translucent={false}
        />
      ) : (
        <StatusBar style={onHome ? "light" : "dark"} />
      )}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: onHome ? "#12100E" : colors.bg },
          animation: "slide_from_right",
          gestureEnabled: true,
                  }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="mom" />
        <Stack.Screen name="fund/[code]" />
        <Stack.Screen name="module/[id]" />
        <Stack.Screen name="knowledge" />
        <Stack.Screen name="researcher" />
        <Stack.Screen name="private-funds" />
        <Stack.Screen name="quotes" />
        <Stack.Screen name="quotes-pro" />
        <Stack.Screen name="all-weather" />
      </Stack>
    </>
  )
}
