import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/auth"
import { colors } from "@/theme"

export default function MeScreen() {
  const { user, logout } = useAuth()

  function onLogout() {
    Alert.alert("退出登录", "退出后需要重新登录才能查看跟踪产品。", [
      { text: "取消", style: "cancel" },
      { text: "退出", style: "destructive", onPress: () => void logout() },
    ])
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <Text style={styles.eyebrow}>账户</Text>
      <Text style={styles.title}>我的</Text>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name || "用").slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.name || "未登录"}</Text>
          <Text style={styles.meta}>{user?.email || "当前账号"}</Text>
          {user?.role ? <Text style={styles.role}>{user.role === "admin" ? "管理员" : "用户"}</Text> : null}
        </View>
      </View>
      <Text style={styles.note}>跟踪、搜索和净值在手机上查看。风控报表、估值表和导入仍在电脑上使用。</Text>
      <Pressable style={styles.logout} onPress={onLogout}>
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 8 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4, marginBottom: 22 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: colors.line },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.bg, fontSize: 20, fontWeight: "700" },
  name: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  role: { color: colors.gold, fontSize: 12, marginTop: 4, letterSpacing: 1 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 28 },
  logout: { marginTop: 28, paddingVertical: 14, alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line },
  logoutText: { color: colors.danger, fontWeight: "700", letterSpacing: 1 },
})
