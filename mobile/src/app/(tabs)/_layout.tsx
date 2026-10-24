import { Pressable, StyleSheet, Text, View } from "react-native"
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs"
import { VoiceBall } from "@/components/VoiceBall"
import { colors } from "@/theme"

function Bar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const left = state.routes.slice(0, 2)
  const right = state.routes.slice(2)

  const renderTab = (route: (typeof state.routes)[number], index: number) => {
    const focused = state.index === index
    const label = descriptors[route.key]?.options.title || route.name
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigateToTab(route.key)
        }}
        style={styles.item}
      >
        <Text style={[styles.label, focused && styles.labelOn]}>{label}</Text>
        <View style={[styles.mark, focused && styles.markOn]} />
      </Pressable>
    )
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {left.map((route, i) => renderTab(route, i))}
      <VoiceBall />
      {right.map((route, i) => renderTab(route, i + left.length))}
    </View>
  )
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <Bar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" options={{ title: "首页" }} />
      <Tabs.Screen name="tracking" options={{ title: "跟踪" }} />
      <Tabs.Screen name="search" options={{ title: "搜索" }} />
      <Tabs.Screen name="me" options={{ title: "我的" }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    overflow: "visible",
    zIndex: 10,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-end", minHeight: 42, gap: 8 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.2 },
  labelOn: { color: colors.ink },
  mark: { width: 18, height: 2, backgroundColor: "transparent" },
  markOn: { backgroundColor: colors.gold },
})
