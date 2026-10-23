import { useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/auth"
import { currentVersionLabel, promptAppUpdate, readAutoUpdate, writeAutoUpdate } from "@/app-update"
import { colors } from "@/theme"

export default function MeScreen() {
  const { user, logout } = useAuth()
  const [working, setWorking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState("")
  const [autoUpdate, setAutoUpdate] = useState(false)

  useEffect(() => {
    void readAutoUpdate().then(setAutoUpdate)
  }, [])

  function onAutoUpdate(enabled: boolean) {
    setAutoUpdate(enabled)
    void writeAutoUpdate(enabled).then(() => {
      if (!enabled) return
      setWorking(true)
      setUpdateStatus("")
      void promptAppUpdate(true, setUpdateStatus).finally(() => setWorking(false))
    })
  }

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
      <Text style={styles.note}>跟踪、搜索、净值和每日风控可在手机上查看。估值表和数据导入仍在电脑上使用。</Text>
      <Pressable
        style={styles.update}
        disabled={working}
        onPress={() => {
          setWorking(true)
          setUpdateStatus("")
          void promptAppUpdate(true, setUpdateStatus).finally(() => setWorking(false))
        }}
      >
        <Text style={styles.updateTitle}>{working && !updateStatus ? "正在检查…" : "检查更新"}</Text>
        <Text style={styles.updateMeta}>{updateStatus || `当前版本 ${currentVersionLabel()}`}</Text>
      </Pressable>
      <View style={styles.auto}>
        <View style={{ flex: 1 }}>
          <Text style={styles.updateTitle}>自动检查更新</Text>
          <Text style={styles.updateMeta}>打开应用后，有新版本就自动下载并打开安装</Text>
        </View>
        <Switch
          value={autoUpdate}
          onValueChange={onAutoUpdate}
          trackColor={{ false: colors.line, true: colors.gold }}
          thumbColor={colors.card}
        />
      </View>
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
  update: { marginTop: 22, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.line },
  updateTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  updateMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  auto: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  logout: { marginTop: 8, paddingVertical: 14, alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line },
  logoutText: { color: colors.danger, fontWeight: "700", letterSpacing: 1 },
})
