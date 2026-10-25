import { Stack } from "expo-router"
import { colors } from "@/theme"

export default function MomLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "slide_from_right",
        gestureEnabled: true,
        fullScreenGestureEnabled: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="daily" />
      <Stack.Screen name="account" />
      <Stack.Screen
        name="briefing"
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: false,
          animationTypeForReplace: "push",
        }}
      />
    </Stack>
  )
}
