import { type ReactNode, useEffect, useState } from "react"
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/**
 * Shared keyboard wrapper for every TextInput screen.
 * - Manifest / app.json: windowSoftInputMode=adjustResize (softwareKeyboardLayoutMode=resize)
 * - iOS: KeyboardAvoidingView padding
 * - Android: lift via keyboard height padding (adjustResize alone is unreliable on
 *   OEM / edge-to-edge skins such as Huawei; do not also apply KAV padding or it doubles)
 */
export function KeyboardSafe({
  children,
  style,
  offset = 0,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** Extra offset above the keyboard (e.g. custom header). */
  offset?: number
}) {
  const insets = useSafeAreaInsets()
  const [androidPad, setAndroidPad] = useState(0)

  useEffect(() => {
    if (Platform.OS !== "android") return
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidPad(Math.max(0, e.endCoordinates.height - insets.bottom + offset))
    })
    const hide = Keyboard.addListener("keyboardDidHide", () => setAndroidPad(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [insets.bottom, offset])

  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView
        style={[{ flex: 1 }, style]}
        behavior="padding"
        keyboardVerticalOffset={offset + insets.top}
      >
        {children}
      </KeyboardAvoidingView>
    )
  }

  return (
    <KeyboardAvoidingView style={[{ flex: 1 }, style]} enabled={false}>
      <View style={{ flex: 1, paddingBottom: androidPad }}>{children}</View>
    </KeyboardAvoidingView>
  )
}
