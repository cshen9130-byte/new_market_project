import { useFocusEffect, usePreventRemove } from "expo-router"
import { useCallback, useRef } from "react"
import { BackHandler } from "react-native"

/**
 * While `active`, the system back gesture stays on this screen and runs `onBack`
 * (one folder, one skill, or one in-screen page). Expo Router 58 does not emit
 * `beforeRemove`; it blocks the pop and emits `removePrevented` instead.
 * The hardware listener is registered after the navigator's so it runs first.
 */
export function useStepBack(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const stepping = useRef(false)

  const step = useCallback(() => {
    if (stepping.current) return
    stepping.current = true
    try {
      onBackRef.current()
    } finally {
      stepping.current = false
    }
  }, [])

  usePreventRemove(active, step)

  useFocusEffect(
    useCallback(() => {
      if (!active) return
      let subscription: { remove: () => void } | null = null
      const timer = setTimeout(() => {
        subscription = BackHandler.addEventListener("hardwareBackPress", () => {
          step()
          return true
        })
      }, 0)
      return () => {
        clearTimeout(timer)
        subscription?.remove()
      }
    }, [active, step]),
  )
}
