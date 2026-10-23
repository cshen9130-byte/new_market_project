import { useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs"
import { colors } from "@/theme"
import { AiVoiceOverlay, type AiVoiceOverlayHandle } from "@/components/AiVoiceOverlay"

const HOLD_MS = 280

type BallHandlers = {
  holding: boolean
  onBallIn: () => void
  onBallOut: () => void
}

function Bar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  holding,
  onBallIn,
  onBallOut,
}: BottomTabBarProps & BallHandlers) {
  const left = state.routes.slice(0, 2)
  const right = state.routes.slice(2)
  const scale = useRef(new Animated.Value(1)).current

  function renderTab(route: (typeof state.routes)[number], index: number) {
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

  function handleIn() {
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
    onBallIn()
  }

  function handleOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 6 }).start()
    onBallOut()
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {left.map((route, i) => renderTab(route, i))}
      <View style={styles.centerSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="AI"
          accessibilityHint="长按说话"
          testID="ai-ball"
          onPressIn={handleIn}
          onPressOut={handleOut}
          delayLongPress={10_000}
          style={styles.ballHit}
        >
          <Animated.View
            style={[
              styles.ballOuter,
              holding && styles.ballOuterHot,
              { transform: [{ scale }] },
            ]}
          >
            <View style={[styles.ballInner, holding && styles.ballInnerHot]}>
              <Text style={[styles.ballText, holding && styles.ballTextHot]}>{holding ? "…" : "AI"}</Text>
            </View>
          </Animated.View>
        </Pressable>
      </View>
      {right.map((route, i) => renderTab(route, i + 2))}
    </View>
  )
}

export default function TabsLayout() {
  const overlayRef = useRef<AiVoiceOverlayHandle>(null)
  const [holding, setHolding] = useState(false)
  const pressAt = useRef(0)

  function onBallIn() {
    pressAt.current = Date.now()
    setHolding(true)
    overlayRef.current?.beginHold()
  }

  function onBallOut() {
    const dur = Date.now() - pressAt.current
    setHolding(false)
    if (dur < HOLD_MS) {
      overlayRef.current?.cancelHold()
      overlayRef.current?.showHint()
      return
    }
    void overlayRef.current?.endHold()
  }

  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => (
          <Bar {...props} holding={holding} onBallIn={onBallIn} onBallOut={onBallOut} />
        )}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="home" options={{ title: "首页" }} />
        <Tabs.Screen name="tracking" options={{ title: "跟踪" }} />
        <Tabs.Screen name="search" options={{ title: "搜索" }} />
        <Tabs.Screen name="me" options={{ title: "我的" }} />
      </Tabs>
      <AiVoiceOverlay ref={overlayRef} holding={holding} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    zIndex: 20,
    overflow: "visible",
  },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-end", minHeight: 42, gap: 8 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.2 },
  labelOn: { color: colors.ink },
  mark: { width: 18, height: 2, backgroundColor: "transparent" },
  markOn: { backgroundColor: colors.gold },
  centerSlot: {
    width: 72,
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: -28,
    zIndex: 30,
  },
  ballHit: { alignItems: "center", justifyContent: "center" },
  ballOuter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#C6A36A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#E7C98A",
    shadowOpacity: 0.85,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 2,
    borderColor: "#E7C98A",
  },
  ballOuterHot: {
    backgroundColor: "#B42318",
    borderColor: "#F97066",
    shadowColor: "#B42318",
  },
  ballInner: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#1A1814",
    alignItems: "center",
    justifyContent: "center",
  },
  ballInnerHot: {
    backgroundColor: "#3B0A0A",
  },
  ballText: {
    color: "#FFF6E8",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  ballTextHot: {
    color: "#FEE4E2",
  },
})
