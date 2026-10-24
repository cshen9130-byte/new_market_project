import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { useStepBack } from "@/use-step-back"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  fetchKnowledgeText,
  fetchKnowledgeTree,
  streamKnowledge,
  type KbDocument,
  type KbFolder,
} from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { colors } from "@/theme"

type Turn = { role: "user" | "assistant"; content: string }
type Scope = { kind: "library" } | { kind: "folder"; path: string; name: string } | { kind: "file"; path: string; name: string }

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml", ".docx"])

export default function KnowledgeScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ q?: string; ask?: string }>()
  const bootstrapped = useRef(false)
  const [tree, setTree] = useState<KbFolder | null>(null)
  const [trail, setTrail] = useState<KbFolder[]>([])
  const [filter, setFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reading, setReading] = useState<{ name: string; path: string; text: string } | null>(null)
  const [scope, setScope] = useState<Scope>({ kind: "library" })
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchKnowledgeTree()
      .then((next) => {
        if (!cancelled) setTree(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "知识库加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (bootstrapped.current) return
    const raw = params.q
    const incoming = Array.isArray(raw) ? raw[0] : raw
    const trimmed = (incoming ?? "").trim()
    if (!trimmed) return
    bootstrapped.current = true
    setAsking(true)
    setQuestion(trimmed)
    const shouldAsk = (Array.isArray(params.ask) ? params.ask[0] : params.ask) !== "0"
    if (shouldAsk) {
      // Defer so state above is committed before ask() reads question via closure-safe path.
      const timer = setTimeout(() => {
        void askWithText(trimmed)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [params.q, params.ask])

  const folder = trail[trail.length - 1] ?? tree
  const visible = useMemo(() => {
    if (!folder) return { folders: [] as KbFolder[], documents: [] as KbDocument[] }
    const q = filter.trim().toLowerCase()
    const folders = [...folder.folders].sort((a, b) => a.name.localeCompare(b.name, "zh"))
    const documents = [...folder.documents].sort((a, b) => a.name.localeCompare(b.name, "zh"))
    if (!q) return { folders, documents }
    return {
      folders: folders.filter((item) => item.name.toLowerCase().includes(q)),
      documents: documents.filter((item) => item.name.toLowerCase().includes(q)),
    }
  }, [folder, filter])

  function goBack() {
    if (asking) {
      setAsking(false)
      return
    }
    if (reading) {
      setReading(null)
      return
    }
    if (trail.length > 0) {
      const next = trail.slice(0, -1)
      setTrail(next)
      const parent = next[next.length - 1]
      setScope(parent ? { kind: "folder", path: parent.relativePath, name: parent.name } : { kind: "library" })
      setFilter("")
      return
    }
    router.back()
  }

  const nested = asking || reading != null || trail.length > 0
  useStepBack(nested, goBack)

  function openFolder(next: KbFolder) {
    setTrail((current) => [...current, next])
    setScope({ kind: "folder", path: next.relativePath, name: next.name })
    setFilter("")
    setReading(null)
  }

  async function openDocument(doc: KbDocument) {
    setScope({ kind: "file", path: doc.relativePath, name: doc.name })
    if (!TEXT_EXT.has(doc.extension.toLowerCase())) {
      setReading({ name: doc.name, path: doc.relativePath, text: "这份资料不能在手机上直接展开。可以就它向知识库提问。" })
      return
    }
    setReading({ name: doc.name, path: doc.relativePath, text: "" })
    setError("")
    try {
      const text = await fetchKnowledgeText(doc.relativePath)
      setReading({ name: doc.name, path: doc.relativePath, text: text.trim() || "这份资料是空的。" })
    } catch (err) {
      setReading({
        name: doc.name,
        path: doc.relativePath,
        text: err instanceof Error ? err.message : "打不开这份资料",
      })
    }
  }

  async function ask() {
    await askWithText(question)
  }

  async function askWithText(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || busyRef.current) return
    busyRef.current = true
    const history = turns.filter((turn) => turn.content.trim()).map((turn) => ({ role: turn.role, content: turn.content }))
    setTurns((current) => [...current, { role: "user", content: trimmed }, { role: "assistant", content: "" }])
    setQuestion("")
    setAsking(true)
    setBusy(true)
    setError("")
    const controller = new AbortController()
    abortRef.current = controller
    const body: Record<string, unknown> = {
      question: trimmed,
      history,
      stream: true,
      modelMode: "plus",
      useBm25: true,
      title: scope.kind === "library" ? "全部资料" : scope.name,
    }
    if (scope.kind === "file") body.filePath = scope.path
    if (scope.kind === "folder") body.folderPath = scope.path
    try {
      await streamKnowledge(body, (event) => {
        if (event.type === "text") {
          const delta = String(event.delta ?? "")
          if (!delta) return
          setTurns((current) => {
            const next = current.slice()
            const last = next[next.length - 1]
            if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", content: last.content + delta }
            return next
          })
        } else if (event.type === "error") {
          setError(String(event.message ?? "提问失败"))
        }
      }, controller.signal)
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "提问失败")
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const scopeLabel = scope.kind === "library" ? "全部资料" : scope.name
  const title = reading ? reading.name : folder?.name || "AI知识库"

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardSafe style={styles.flex}>
        <View style={styles.top}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={styles.back}>{trail.length || reading || asking ? "返回" : "首页"}</Text>
          </Pressable>
          <Pressable onPress={() => setAsking((value) => !value)}>
            <Text style={styles.switch}>{asking ? "资料" : "提问"}</Text>
          </Pressable>
        </View>
        <Text style={styles.eyebrow}>AI知识库</Text>
        <Text style={styles.title} numberOfLines={2}>{asking ? "提问" : title}</Text>
        <Text style={styles.scope}>范围 · {scopeLabel}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {asking ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.chat} keyboardShouldPersistTaps="handled">
            {turns.length === 0 ? <Text style={styles.hint}>问题会按当前范围检索资料，再给出回答。</Text> : null}
            {turns.map((turn, index) => (
              <View key={`${turn.role}-${index}`} style={turn.role === "user" ? styles.userBubble : styles.answer}>
                <Text style={turn.role === "user" ? styles.userText : styles.answerText}>{turn.content || (busy ? "正在检索资料…" : "")}</Text>
              </View>
            ))}
          </ScrollView>
        ) : reading ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
            <Text style={styles.doc}>{reading.text || "正在读取…"}</Text>
            <Pressable style={styles.askLink} onPress={() => setAsking(true)}>
              <Text style={styles.askLinkText}>就这份资料提问</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="筛选当前文件夹"
              placeholderTextColor="#A39E96"
              style={styles.filter}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {loading ? <ActivityIndicator color={colors.up} style={{ marginTop: 28 }} /> : null}
            {!loading && visible.folders.length === 0 && visible.documents.length === 0 ? (
              <Text style={styles.hint}>这里没有匹配的资料。</Text>
            ) : null}
            {visible.folders.map((item) => (
              <Pressable key={item.relativePath || item.name} style={styles.row} onPress={() => openFolder(item)}>
                <Text style={styles.kind}>文件夹</Text>
                <Text style={styles.name}>{item.name}</Text>
              </Pressable>
            ))}
            {visible.documents.map((item) => (
              <Pressable key={item.relativePath} style={styles.row} onPress={() => void openDocument(item)}>
                <Text style={styles.kind}>{item.extension.replace(".", "").toUpperCase() || "文件"}</Text>
                <Text style={styles.name}>{item.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.composer}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder={scope.kind === "file" ? "就这份资料提问" : "向当前范围提问"}
            placeholderTextColor="#A39E96"
            style={styles.input}
            editable={!busy}
          />
          <Pressable onPress={() => (busy ? abortRef.current?.abort() : void ask())} hitSlop={8}>
            <Text style={styles.send}>{busy ? "停止" : "发送"}</Text>
          </Pressable>
        </View>
      </KeyboardSafe>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: { paddingHorizontal: 22, paddingTop: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  switch: { color: colors.ink, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 14, paddingHorizontal: 22 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.3, marginTop: 2, paddingHorizontal: 22 },
  scope: { color: colors.muted, fontSize: 13, marginTop: 6, marginBottom: 8, paddingHorizontal: 22 },
  error: { color: colors.danger, paddingHorizontal: 22, marginBottom: 6 },
  body: { paddingHorizontal: 22, paddingBottom: 16 },
  filter: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 10, fontSize: 16, color: colors.text, marginBottom: 8 },
  hint: { color: colors.muted, lineHeight: 22, marginTop: 12 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 3 },
  kind: { color: colors.gold, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  doc: { color: colors.text, fontSize: 15, lineHeight: 24 },
  askLink: { marginTop: 18, alignSelf: "flex-start" },
  askLinkText: { color: colors.gold, fontWeight: "700", letterSpacing: 0.6 },
  chat: { paddingHorizontal: 22, paddingBottom: 16, gap: 12 },
  userBubble: { alignSelf: "flex-end", maxWidth: "86%", backgroundColor: colors.ink, paddingHorizontal: 12, paddingVertical: 10 },
  userText: { color: colors.bg, fontSize: 15, lineHeight: 22 },
  answer: { alignSelf: "stretch" },
  answerText: { color: colors.text, fontSize: 15, lineHeight: 24 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 8 },
  send: { color: colors.gold, fontWeight: "700", letterSpacing: 1 },
})
