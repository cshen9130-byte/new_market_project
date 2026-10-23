import { useState, type ComponentProps } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/auth"
import { colors } from "@/theme"

export default function LoginScreen() {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    if (!identifier.trim() || !password) {
      setError("请填写账号和密码")
      return
    }
    setBusy(true)
    setError("")
    try {
      await login(identifier, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.mark}>FOF</Text>
            <View style={styles.rule} />
            <Text style={styles.kicker}>母基金投研</Text>
            <Text style={styles.title}>手机看板</Text>
            <Text style={styles.subtitle}>跟踪产品、搜索基金、查看净值。</Text>
          </View>
          <View style={styles.form}>
            <Field
              label="账号"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="用户名或邮箱"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Field
              label="密码"
              value={password}
              onChangeText={setPassword}
              placeholder="密码"
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={() => void onSubmit()}
            />
            {error ? <Text style={styles.error} numberOfLines={3}>{error}</Text> : null}
            <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={onSubmit} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.buttonText}>登录</Text>}
            </Pressable>
            <Text style={styles.hint}>账号与电脑版相同。</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({
  label,
  ...input
}: { label: string } & ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#A39E96" style={styles.input} {...input} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  hero: { marginBottom: 36 },
  mark: { color: colors.gold, fontSize: 13, fontWeight: "700", letterSpacing: 4 },
  rule: { width: 36, height: 2, backgroundColor: colors.gold, marginTop: 14, marginBottom: 18 },
  kicker: { color: colors.muted, fontSize: 13, letterSpacing: 2 },
  title: { color: colors.text, fontSize: 40, fontWeight: "700", marginTop: 6, letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 10 },
  form: { gap: 4 },
  field: { paddingTop: 14 },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 0.4 },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  error: { color: colors.danger, marginTop: 12, fontSize: 13, lineHeight: 18 },
  button: { backgroundColor: colors.ink, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 22 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: "700", letterSpacing: 2 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 16 },
})
