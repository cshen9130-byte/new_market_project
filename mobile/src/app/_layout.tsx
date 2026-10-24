import { ActivityIndicator, View } from "react-native"
import { useEffect } from "react"
import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AuthProvider, useAuth } from "@/auth"
import { promptAppUpdate } from "@/app-update"
import { colors } from "@/theme"

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
    if (!ready) return
    void promptAppUpdate(false)
  }, [ready])

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.up} />
      </View>
    )
  }

  return (
    <>
      <StatusBar style={onHome ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
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
