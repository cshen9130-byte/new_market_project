import { Pressable, StyleSheet, Text, View } from "react-native"
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs"
import { colors } from "@/theme"

function Bar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {state.routes.map((route, index) => {
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
      })}
    </View>
  )
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <Bar {...props} />}
      screenOptions={{ headerShown: false }}
    >
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
    paddingTop: 12,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-end", minHeight: 42, gap: 8 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.2 },
  labelOn: { color: colors.ink },
  mark: { width: 18, height: 2, backgroundColor: "transparent" },
  markOn: { backgroundColor: colors.gold },
})
