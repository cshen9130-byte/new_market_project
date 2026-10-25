import { Component, type ErrorInfo, type ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { getLastBootTag } from "@/crash-boot"

type Props = { children: ReactNode; featureTag?: string }
type State = { error: Error | null; bootTag: string | null }

/**
 * Catches render/JS errors; shows lastBootTag so Huawei flash crashes leave a clue.
 * Does not catch native SIGSEGV — those still need A/B flags.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, bootTag: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const tag = this.props.featureTag || "unknown"
    console.error("[ErrorBoundary]", tag, error?.message, info?.componentStack)
    void getLastBootTag().then((bootTag) => this.setState({ bootTag }))
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <View style={styles.box}>
        <Text style={styles.title}>界面出错</Text>
        <Text style={styles.msg}>{this.state.error.message}</Text>
        {this.state.bootTag ? <Text style={styles.tag}>boot: {this.state.bootTag}</Text> : null}
        {this.props.featureTag ? <Text style={styles.tag}>feature: {this.props.featureTag}</Text> : null}
        <Pressable
          style={styles.btn}
          onPress={() => this.setState({ error: null, bootTag: null })}
        >
          <Text style={styles.btnText}>重试</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F3F0EA" },
  title: { fontSize: 18, fontWeight: "700", color: "#1A1814", marginBottom: 8 },
  msg: { fontSize: 13, color: "#7A756E", textAlign: "center", marginBottom: 8 },
  tag: { fontSize: 11, color: "#9A7B4F", marginTop: 4 },
  btn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#1A1814", borderRadius: 8 },
  btnText: { color: "#FFF8EE", fontWeight: "700" },
})
