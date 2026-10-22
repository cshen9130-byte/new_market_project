import { Stack } from "expo-router"
import { colors } from "@/theme"

export default function MomLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
}
