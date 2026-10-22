import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"
import Svg, { Circle, Defs, Ellipse, G, Line, Polygon, RadialGradient, Stop } from "react-native-svg"

function useLoop(duration: number, delay = 0) {
  const value = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [delay, duration, value])
  return value
}

function useSpin(duration: number) {
  const value = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    )
    anim.start()
    return () => anim.stop()
  }, [duration, value])
  return value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })
}

function Shadow() {
  return <Ellipse cx="70" cy="108" rx="36" ry="7" fill="rgba(0,0,0,0.45)" />
}

function Column({ cx, base, h, lift = 0 }: { cx: number; base: number; h: number; lift?: number }) {
  const hw = 15
  const hd = 8
  const top = base - h - lift
  const left = `${cx - hw},${top + hd} ${cx},${top + hd * 2} ${cx},${base} ${cx - hw},${base - hd}`
  const right = `${cx},${top + hd * 2} ${cx + hw},${top + hd} ${cx + hw},${base - hd} ${cx},${base}`
  const cap = `${cx - hw},${top + hd} ${cx},${top} ${cx + hw},${top + hd} ${cx},${top + hd * 2}`
  return (
    <G>
      <Polygon points={left} fill="#6E5438" />
      <Polygon points={right} fill="#C6A36A" />
      <Polygon points={cap} fill="#F6E7D0" />
    </G>
  )
}

export function FundObject() {
  const rise = useLoop(1700)
  const lift = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -12] })
  return (
    <View style={styles.stage}>
      <Svg width={140} height={120} viewBox="0 0 140 120">
        <Shadow />
        <Column cx={38} base={100} h={30} />
        <Column cx={100} base={100} h={40} />
      </Svg>
      <Animated.View style={[styles.overlay, { transform: [{ translateY: lift }] }]}>
        <Svg width={140} height={120} viewBox="0 0 140 120">
          <Column cx={69} base={100} h={58} />
        </Svg>
      </Animated.View>
    </View>
  )
}

export function MomObject() {
  const bob = useLoop(2100, 200)
  const y1 = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] })
  const y2 = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -9] })
  return (
    <View style={styles.stage}>
      <Svg width={140} height={120} viewBox="0 0 140 120">
        <Shadow />
        <Ellipse cx="70" cy="96" rx="34" ry="10" fill="#5C4632" />
        <Ellipse cx="70" cy="90" rx="34" ry="10" fill="#C6A36A" />
        <Ellipse cx="70" cy="86" rx="34" ry="10" fill="#F3E4CC" />
      </Svg>
      <Animated.View style={[styles.overlay, { transform: [{ translateY: y1 }] }]}>
        <Svg width={140} height={120} viewBox="0 0 140 120">
          <Ellipse cx="70" cy="74" rx="26" ry="8" fill="#6E5438" />
          <Ellipse cx="70" cy="69" rx="26" ry="8" fill="#E7C98A" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.overlay, { transform: [{ translateY: y2 }] }]}>
        <Svg width={140} height={120} viewBox="0 0 140 120">
          <Ellipse cx="70" cy="52" rx="16" ry="6" fill="#8C6A3E" />
          <Ellipse cx="70" cy="48" rx="16" ry="6" fill="#FFF8EE" />
          <Circle cx="86" cy="48" r="3" fill="#C45C4A" />
        </Svg>
      </Animated.View>
    </View>
  )
}

export function QuoteObject() {
  const spin = useSpin(5200)
  return (
    <View style={styles.stage}>
      <Svg width={140} height={120} viewBox="0 0 140 120">
        <Defs>
          <RadialGradient id="quoteSphere" cx="38%" cy="34%" r="68%">
            <Stop offset="0" stopColor="#FFF8EE" />
            <Stop offset="0.45" stopColor="#E4C48A" />
            <Stop offset="1" stopColor="#6A4E32" />
          </RadialGradient>
        </Defs>
        <Shadow />
        <Ellipse cx="70" cy="64" rx="40" ry="13" fill="none" stroke="#C6A36A" strokeWidth="1.4" opacity="0.7" />
        <Circle cx="70" cy="62" r="26" fill="url(#quoteSphere)" />
        <Ellipse cx="60" cy="52" rx="8" ry="5" fill="rgba(255,255,255,0.55)" />
      </Svg>
      <Animated.View style={[styles.overlay, { transform: [{ rotate: spin }] }]}>
        <View style={styles.orbitDot} />
      </Animated.View>
    </View>
  )
}

export function KnowledgeObject() {
  const fan = useLoop(2400, 400)
  const turn = fan.interpolate({ inputRange: [0, 1], outputRange: ["-8deg", "10deg"] })
  return (
    <View style={styles.stage}>
      <Svg width={140} height={120} viewBox="0 0 140 120">
        <Shadow />
        <Polygon points="28,78 108,78 98,92 38,92" fill="#5C4632" />
        <Polygon points="32,66 104,66 108,78 28,78" fill="#C6A36A" />
        <Polygon points="36,56 100,56 104,66 32,66" fill="#E7D3B0" />
      </Svg>
      <Animated.View style={[styles.page, { transform: [{ rotate: turn }] }]}>
        <Svg width="78" height="36" viewBox="0 0 78 36">
          <Polygon points="6,28 72,20 68,8 2,16" fill="#FFF8EE" />
          <Line x1="16" y1="18" x2="60" y2="13" stroke="#C6A36A" strokeWidth="1.2" />
          <Line x1="16" y1="23" x2="52" y2="19" stroke="#E4D3B8" strokeWidth="1.2" />
        </Svg>
      </Animated.View>
    </View>
  )
}

export function ResearcherObject() {
  const pulse = useLoop(1800, 100)
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] })
  return (
    <View style={styles.stage}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Svg width={140} height={120} viewBox="0 0 140 120">
          <Shadow />
          <Polygon points="70,18 104,62 70,78 36,62" fill="#F6E7D0" />
          <Polygon points="70,78 104,62 92,84 70,102" fill="#C6A36A" />
          <Polygon points="70,78 36,62 48,84 70,102" fill="#6E5438" />
          <Polygon points="70,34 92,62 70,74 48,62" fill="rgba(255,255,255,0.35)" />
        </Svg>
      </Animated.View>
    </View>
  )
}

export function WeatherObject() {
  const spin = useSpin(7000)
  const tilt = useLoop(2600, 300)
  const rock = tilt.interpolate({ inputRange: [0, 1], outputRange: ["-16deg", "16deg"] })
  return (
    <View style={styles.stage}>
      <Svg width={140} height={120} viewBox="0 0 140 120">
        <Defs>
          <RadialGradient id="globe" cx="40%" cy="36%" r="70%">
            <Stop offset="0" stopColor="#F7F1E6" />
            <Stop offset="0.5" stopColor="#D7B98A" />
            <Stop offset="1" stopColor="#5A4330" />
          </RadialGradient>
        </Defs>
        <Shadow />
        <Circle cx="70" cy="60" r="28" fill="url(#globe)" />
        <Ellipse cx="70" cy="60" rx="12" ry="28" fill="none" stroke="rgba(255,248,238,0.45)" strokeWidth="1.2" />
        <Ellipse cx="70" cy="60" rx="28" ry="10" fill="none" stroke="rgba(255,248,238,0.4)" strokeWidth="1.2" />
      </Svg>
      <Animated.View style={[styles.overlay, { transform: [{ rotate: rock }] }]}>
        <Svg width={140} height={120} viewBox="0 0 140 120">
          <Ellipse cx="70" cy="60" rx="44" ry="16" fill="none" stroke="#E7C98A" strokeWidth="1.3" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.overlay, { transform: [{ rotate: spin }] }]}>
        <View style={styles.satellite} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  stage: { width: 140, height: 120, alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", width: 140, height: 120, alignItems: "center" },
  orbitDot: {
    position: "absolute",
    top: 16,
    left: 66,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#FFF8EE",
  },
  page: { position: "absolute", top: 28, left: 31 },
  satellite: {
    position: "absolute",
    top: 8,
    left: 66,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFF8EE",
  },
})
