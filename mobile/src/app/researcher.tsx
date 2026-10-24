import { useRouter } from "expo-router"
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
import { searchResearchFunds, streamResearch, type ResearchFundHit } from "@/api"
import { displayFundName, strategyLine } from "@/format"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { colors } from "@/theme"

type SkillKind = "funds" | "one-fund" | "keyword" | "manager"

type Skill = {
  id: string
  name: string
  description: string
  kind: SkillKind
  apiPath: string
  steps: string[]
  chips?: string[]
}

type StepState = { step: number; title: string; status: "waiting" | "running" | "done" | "error"; summary?: string }

const SKILLS: Skill[] = [
  {
    id: "compare-analysis",
    name: "同策略对比分析",
    description: "选两只或更多产品，生成净值、绩效和管理人对比。",
    kind: "funds",
    apiPath: "compare-analysis",
    steps: ["搜索匹配基金", "获取净值历史", "获取管理人背景", "查询知识库", "生成对比报告"],
  },
  {
    id: "similar-fund",
    name: "相似基金匹配",
    description: "选一只产品，从全库找出走势最接近的基金。",
    kind: "one-fund",
    apiPath: "similar-fund",
    steps: ["解析目标基金", "构建候选池", "计算相似度", "查询知识库", "生成分析报告"],
  },
  {
    id: "opposite-fund",
    name: "相反基金匹配",
    description: "选一只产品，找出走势最相反、适合对冲的基金。",
    kind: "one-fund",
    apiPath: "opposite-fund",
    steps: ["获取目标基金", "构建候选池", "计算负相关", "查询知识库", "生成对冲报告"],
  },
  {
    id: "team-background",
    name: "团队背景筛选",
    description: "输入前任机构，找出团队里有这段履历的管理人。",
    kind: "keyword",
    apiPath: "team-background",
    steps: ["检索高管履历", "检索尽调材料", "汇总管理人", "整理证据", "生成筛选报告"],
    chips: ["瑞银", "高盛", "中金", "幻方"],
  },
  {
    id: "manager-profile",
    name: "管理人深度画像",
    description: "输入管理人名称，整理登记信息、团队、产品和业绩。",
    kind: "manager",
    apiPath: "manager-profile",
    steps: ["检索登记信息", "获取团队履历", "获取产品备案", "获取净值", "生成调研报告"],
    chips: ["九坤投资", "幻方量化", "鸣石投资"],
  },
]

type Match = { rank?: number; beian_hao?: string; product_name?: string; correlation?: number | null }

export default function ResearcherScreen() {
  const router = useRouter()
  const [skill, setSkill] = useState<Skill | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ResearchFundHit[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<ResearchFundHit[]>([])
  const [text, setText] = useState("")
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<StepState[]>([])
  const [report, setReport] = useState("")
  const [matches, setMatches] = useState<Match[]>([])
  const [error, setError] = useState("")
  const [started, setStarted] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const failedRef = useRef(false)

  useEffect(() => {
    const q = query.trim()
    if (!skill || (skill.kind !== "funds" && skill.kind !== "one-fund") || !q) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setSearching(true)
      searchResearchFunds(q)
        .then((rows) => {
          if (!cancelled) setHits(rows)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, skill])

  useEffect(() => () => abortRef.current?.abort(), [])

  const canRun = useMemo(() => {
    if (!skill || running) return false
    if (skill.kind === "funds") return picked.length >= 2
    if (skill.kind === "one-fund") return picked.length === 1
    return text.trim().length > 0
  }, [skill, running, picked.length, text])

  function leaveSkill() {
    abortRef.current?.abort()
    setSkill(null)
    setStarted(false)
    setRunning(false)
  }

  useStepBack(skill != null, leaveSkill)

  function openSkill(next: Skill) {
    abortRef.current?.abort()
    setSkill(next)
    setQuery("")
    setHits([])
    setPicked([])
    setText("")
    setRunning(false)
    setSteps(next.steps.map((title, index) => ({ step: index + 1, title, status: "waiting" })))
    setReport("")
    setMatches([])
    setError("")
    setStarted(false)
    failedRef.current = false
  }

  function addFund(fund: ResearchFundHit) {
    if (!skill) return
    if (skill.kind === "one-fund") {
      setPicked([fund])
    } else if (!picked.some((item) => item.beian_hao === fund.beian_hao)) {
      setPicked((current) => [...current, fund])
    }
    setQuery("")
    setHits([])
  }

  async function run() {
    if (!skill || !canRun) return
    const controller = new AbortController()
    abortRef.current = controller
    failedRef.current = false
    setRunning(true)
    setStarted(true)
    setError("")
    setReport("")
    setMatches([])
    setSteps(skill.steps.map((title, index) => ({ step: index + 1, title, status: "waiting" })))
    const names = picked.map((fund) => fund.product_name)
    const body =
      skill.kind === "funds"
        ? { subjects: names, kbPath: "" }
        : skill.kind === "one-fund"
          ? { subject: names[0], kbPath: "", fileNote: "", namedFund: true, beianHao: picked[0]?.beian_hao ?? "" }
          : skill.kind === "manager"
            ? { managerName: text.trim(), kbPath: "" }
            : { keyword: text.trim(), kbPath: "" }
    try {
      await streamResearch(skill.apiPath, body, (event) => {
        if (event.type === "step_start") {
          const step = Number(event.step)
          setSteps((current) => current.map((item) => (item.step === step ? { ...item, status: "running" } : item)))
        } else if (event.type === "step_done") {
          const step = Number(event.step)
          setSteps((current) =>
            current.map((item) =>
              item.step === step ? { ...item, status: "done", summary: String(event.summary ?? "") } : item,
            ),
          )
        } else if (event.type === "report_text") {
          setReport((current) => current + String(event.delta ?? ""))
        } else if (event.type === "matches" && Array.isArray(event.items)) {
          setMatches(event.items as Match[])
        } else if (event.type === "error") {
          failedRef.current = true
          setError(String(event.message ?? "研究失败"))
        }
      }, controller.signal)
      if (!failedRef.current) {
        setSteps((current) => current.map((item) => (item.status === "waiting" || item.status === "running" ? { ...item, status: "done" } : item)))
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("已停止")
      } else {
        failedRef.current = true
        setError(err instanceof Error ? err.message : "研究失败")
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardSafe>
      <View style={styles.top}>
        <Pressable
          onPress={() => {
            if (skill) leaveSkill()
            else router.back()
          }}
          hitSlop={12}
        >
          <Text style={styles.back}>{skill ? "技能" : "返回"}</Text>
        </Pressable>
      </View>
      {!skill ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.eyebrow}>模块</Text>
          <Text style={styles.title}>AI研究员</Text>
          <Text style={styles.lead}>选一个研究技能，填入产品或管理人后开始。</Text>
          {SKILLS.map((item) => (
            <Pressable key={item.id} style={styles.row} onPress={() => openSkill(item)}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{item.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>AI研究员</Text>
          <Text style={styles.title}>{skill.name}</Text>
          <Text style={styles.lead}>{skill.description}</Text>

          {skill.kind === "funds" || skill.kind === "one-fund" ? (
            <>
              {picked.map((fund) => (
                <Pressable key={fund.beian_hao} onPress={() => setPicked((current) => current.filter((item) => item.beian_hao !== fund.beian_hao))}>
                  <Text style={styles.picked}>{displayFundName(fund.product_name)} · 移除</Text>
                </Pressable>
              ))}
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={skill.kind === "funds" ? "搜索并添加至少两只产品" : "搜索一只产品"}
                placeholderTextColor="#A39E96"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searching ? <ActivityIndicator color={colors.up} style={{ marginTop: 12 }} /> : null}
              {hits.map((fund) => (
                <Pressable key={fund.beian_hao} style={styles.hit} onPress={() => addFund(fund)}>
                  <Text style={styles.name}>{displayFundName(fund.product_name)}</Text>
                  <Text style={styles.detail}>
                    {fund.beian_hao}
                    {strategyLine([fund.strategy_l1, fund.strategy_l2]) ? `  ·  ${strategyLine([fund.strategy_l1, fund.strategy_l2])}` : ""}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={skill.kind === "manager" ? "管理人名称" : "前任机构，例如 高盛"}
                placeholderTextColor="#A39E96"
                style={styles.input}
                autoCorrect={false}
              />
              <View style={styles.chips}>
                {(skill.chips ?? []).map((chip) => (
                  <Pressable key={chip} onPress={() => setText(chip)} style={styles.chip}>
                    <Text style={styles.chipText}>{chip}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Pressable style={[styles.run, !canRun && styles.runOff]} disabled={!canRun} onPress={() => void run()}>
            {running ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.runText}>{started && !running ? "再运行一次" : "开始研究"}</Text>}
          </Pressable>
          {running ? (
            <Pressable onPress={() => abortRef.current?.abort()} style={styles.stop}>
              <Text style={styles.stopText}>停止</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {started ? (
            <View style={styles.reportBlock}>
              {steps.map((step) => (
                <Text key={step.step} style={styles.step}>
                  {step.status === "done" ? "完成" : step.status === "running" ? "进行中" : step.status === "error" ? "失败" : "等待"}
                  {"  "}
                  {step.title}
                  {step.summary ? ` · ${step.summary}` : ""}
                </Text>
              ))}
              {matches.length > 0 ? (
                <View style={styles.matches}>
                  <Text style={styles.section}>匹配结果</Text>
                  {matches.map((item, index) => (
                    <Text key={`${item.beian_hao ?? index}`} style={styles.step}>
                      {item.rank ?? index + 1}. {item.product_name || item.beian_hao}
                      {typeof item.correlation === "number" ? `  ·  ${item.correlation.toFixed(2)}` : ""}
                    </Text>
                  ))}
                </View>
              ) : null}
              {report ? <Text style={styles.report}>{report}</Text> : running ? <Text style={styles.detail}>正在生成报告…</Text> : null}
            </View>
          ) : null}
        </ScrollView>
      )}
      </KeyboardSafe>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 4 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.3, marginTop: 2 },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 8 },
  row: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line, gap: 4 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  picked: { color: colors.ink, fontSize: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  input: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 12, fontSize: 16, color: colors.text, marginTop: 8 },
  hit: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: colors.text, fontSize: 13 },
  run: { marginTop: 18, backgroundColor: colors.ink, minHeight: 48, alignItems: "center", justifyContent: "center" },
  runOff: { opacity: 0.4 },
  runText: { color: colors.bg, fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  stop: { alignSelf: "flex-start", marginTop: 12, paddingVertical: 6 },
  stopText: { color: colors.danger, fontWeight: "700" },
  error: { color: colors.danger, marginTop: 10, lineHeight: 20 },
  reportBlock: { marginTop: 22, gap: 8 },
  step: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  section: { color: colors.gold, fontSize: 12, fontWeight: "700", letterSpacing: 1, marginTop: 8 },
  matches: { gap: 4 },
  report: { color: colors.text, fontSize: 15, lineHeight: 24, marginTop: 8 },
})
