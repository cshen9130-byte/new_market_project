import { useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { FundObject, KnowledgeObject, MomObject, QuoteObject, ResearcherObject, WeatherObject } from "@/components/home-objects"

const MODULES = [
  { title: "私募基金", href: "/private-funds", figure: FundObject },
  { title: "MOM分析", href: "/module/mom", figure: MomObject },
  { title: "实时行情", href: "/quotes", figure: QuoteObject },
  { title: "AI知识库", href: "/knowledge", figure: KnowledgeObject },
  { title: "AI研究员", href: "/researcher", figure: ResearcherObject },
  { title: "全天候跟踪", href: "/all-weather", figure: WeatherObject },
] as const

export default function HomeScreen() {
  const travel = useRef(new Animated.Value(0)).current
  const [spots, setSpots] = useState<{ x: number; y: number }[] | null>(null)
  const measured = useRef<{ x: number; y: number; w: number; h: number }[]>([])
  const rowY = useRef<number[]>([])
  const placed = useRef(false)

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(travel, { toValue: 6, duration: 14000, easing: Easing.linear, useNativeDriver: true }),
    )
    anim.start()
    return () => anim.stop()
  }, [travel])

  function publish() {
    if (placed.current) return
    if (rowY.current.filter((value) => value != null).length < 3) return
    if (measured.current.filter(Boolean).length < MODULES.length) return
    placed.current = true
    setSpots(
      measured.current.map((cell, index) => ({
        x: cell.x + cell.w / 2 - 5,
        y: rowY.current[Math.floor(index / 2)] + cell.y + cell.h * 0.36,
      })),
    )
  }

  function remember(index: number, x: number, y: number, width: number, height: number) {
    measured.current[index] = { x, y, w: width, h: height }
    publish()
  }

  const bead = useMemo(() => {
    if (!spots?.length) return null
    const xs = spots.map((spot) => spot.x)
    const ys = spots.map((spot) => spot.y)
    return {
      x: travel.interpolate({ inputRange: [0, 1, 2, 3, 4, 5, 6], outputRange: [...xs, xs[0]] }),
      y: travel.interpolate({ inputRange: [0, 1, 2, 3, 4, 5, 6], outputRange: [...ys, ys[0]] }),
    }
  }, [spots, travel])

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.mark}>FOF</Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.stage}>
        <View style={styles.wash} />
        <View style={styles.washLow} />
        {[0, 1, 2].map((row) => (
          <View
            key={row}
            style={styles.row}
            onLayout={(event) => {
              rowY.current[row] = event.nativeEvent.layout.y
              publish()
            }}
          >
            {MODULES.slice(row * 2, row * 2 + 2).map((item, column) => {
              const index = row * 2 + column
              return (
                <ModuleObject
                  key={item.title}
                  index={index}
                  title={item.title}
                  href={item.href}
                  figure={item.figure}
                  travel={travel}
                  offset={column === 1}
                  onLayout={(x, y, width, height) => remember(index, x, y, width, height)}
                />
              )
            })}
          </View>
        ))}
        {bead ? <Animated.View pointerEvents="none" style={[styles.bead, { transform: [{ translateX: bead.x }, { translateY: bead.y }] }]} /> : null}
      </View>
    </SafeAreaView>
  )
}

function ModuleObject({
  index,
  title,
  href,
  figure: Figure,
  travel,
  offset,
  onLayout,
}: {
  index: number
  title: string
  href: string
  figure: () => ReactElement
  travel: Animated.Value
  offset: boolean
  onLayout: (x: number, y: number, width: number, height: number) => void
}) {
  const router = useRouter()
  const enter = useRef(new Animated.Value(0)).current
  const float = useRef(new Animated.Value(0)).current
  const press = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const intro = Animated.timing(enter, {
      toValue: 1,
      duration: 720,
      delay: 80 + index * 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    const hover = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2200 + index * 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2200 + index * 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    intro.start()
    hover.start()
    return () => {
      intro.stop()
      hover.stop()
    }
  }, [enter, float, index])

  const glow = travel.interpolate({
    inputRange: [index - 0.45, index, index + 0.45],
    outputRange: [0.55, 1, 0.55],
    extrapolate: "clamp",
  })
  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [36, 0] })
  const hoverY = float.interpolate({ inputRange: [0, 1], outputRange: [offset ? 10 : -4, offset ? 2 : -12] })
  const shadow = float.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] })

  return (
    <Animated.View
      onLayout={(event) => {
        const { x, y, width, height } = event.nativeEvent.layout
        onLayout(x, y, width, height)
      }}
      style={[
        styles.cell,
        {
          opacity: enter,
          transform: [{ translateY: Animated.add(rise, hoverY) }, { scale: press }],
        },
      ]}
    >
      <Pressable
        onPressIn={() => Animated.spring(press, { toValue: 0.94, useNativeDriver: true, speed: 28, bounciness: 6 }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 5 }).start()}
        onPress={() => router.push(href)}
        style={styles.hit}
      >
        <Animated.View style={[styles.halo, { opacity: glow, transform: [{ scale: shadow }] }]} />
        <Animated.View style={{ opacity: glow }}>
          <Figure />
        </Animated.View>
        <Text style={styles.caption}>{title}</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#12100E" },
  header: { paddingHorizontal: 22, paddingTop: 6, flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { color: "#C6A36A", fontSize: 12, fontWeight: "700", letterSpacing: 3 },
  rule: { width: 28, height: 2, backgroundColor: "#C6A36A" },
  stage: { flex: 1, paddingHorizontal: 8 },
  row: { flex: 1, flexDirection: "row", alignItems: "center" },
  wash: {
    position: "absolute",
    top: 30,
    left: 24,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(198,163,106,0.09)",
  },
  washLow: {
    position: "absolute",
    bottom: 20,
    right: 10,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(198,163,106,0.06)",
  },
  cell: { flex: 1, alignItems: "center" },
  hit: { alignItems: "center", paddingBottom: 6 },
  halo: {
    position: "absolute",
    top: 78,
    width: 86,
    height: 18,
    borderRadius: 40,
    backgroundColor: "rgba(231,201,138,0.28)",
  },
  caption: { color: "#F3E7D4", fontSize: 13, fontWeight: "700", letterSpacing: 0.6, marginTop: -6 },
  bead: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FFF6E8",
    shadowColor: "#E7C98A",
    shadowOpacity: 1,
    shadowRadius: 8,
    zIndex: 5,
  },
})
