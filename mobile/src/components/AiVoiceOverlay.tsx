import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from "react"
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useRouter } from "expo-router"
import {
  searchFunds,
  streamAssistantChat,
  streamKnowledge,
  streamResearch,
} from "@/api"
import { exportAndShareManagerReport } from "@/share-report"
import { classifyAiIntent, intentAck, fundSearchVariants } from "@/ai-intent"
import { fuzzyMatchManagers, prepareVoiceQuery } from "@/voice-normalize"
import { mapChatHrefToMobile } from "@/ai-navigate"
import { displayFundName } from "@/format"
import { MarkdownAnswer } from "./MarkdownAnswer"

export type AiVoiceOverlayHandle = {
  beginHold: () => void
  endHold: () => Promise<"sent" | "cancelled" | "empty">
  cancelHold: () => void
  showHint: () => void
  /** Feed text from external STT (e.g. Vosk VoiceBall) into the overlay router. */
  ask: (text: string) => Promise<void>
  /** Open the sheet with type-in when STT returned empty. */
  openTypeHint: () => void
}

type Turn = {
  role: "user" | "assistant"
  content: string
  linkPath?: string
  linkLabel?: string
  /** Bare beian_hao for reliable product navigation */
  fundCode?: string
  /** Completed manager-profile markdown for Word/PDF export */
  exportManagerName?: string
  exportMarkdown?: string
  /** Ambiguous STT entity picks shown as chips */
  pickCandidates?: string[]
}

type VoiceApi = {
  available: boolean
  listening: boolean
  start: () => Promise<boolean>
  stop: () => Promise<string>
  abort: () => void
}

function useVoiceInput(): VoiceApi {
  const [listening, setListening] = useState(false)
  const [available, setAvailable] = useState(false)
  const transcriptRef = useRef("")
  const moduleRef = useRef<{
    requestPermissionsAsync: () => Promise<{ granted: boolean }>
    start: (opts: Record<string, unknown>) => void
    stop: () => void
    abort: () => void
    addListener: (event: string, cb: (payload: unknown) => void) => { remove: () => void }
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const subs: Array<{ remove: () => void }> = []
    ;(async () => {
      try {
        const mod = await import("expo-speech-recognition")
        if (cancelled) return
        const api = mod.ExpoSpeechRecognitionModule as NonNullable<typeof moduleRef.current>
        moduleRef.current = api
        setAvailable(true)
        subs.push(
          api.addListener("result", (event: unknown) => {
            const e = event as { isFinal?: boolean; results?: Array<{ transcript?: string }> }
            const text = e.results?.[0]?.transcript ?? ""
            if (text) transcriptRef.current = text
          }),
        )
        subs.push(api.addListener("end", () => setListening(false)))
        subs.push(api.addListener("error", () => setListening(false)))
      } catch {
        if (!cancelled) setAvailable(false)
      }
    })()
    return () => {
      cancelled = true
      for (const sub of subs) sub.remove()
      try {
        moduleRef.current?.abort()
      } catch {
        // ignore
      }
    }
  }, [])

  async function start(): Promise<boolean> {
    const mod = moduleRef.current
    if (!mod) {
      Alert.alert("语音暂不可用", "请打字输入。语音识别需要重新打包 APK（expo-speech-recognition）。")
      return false
    }
    try {
      const perm = await mod.requestPermissionsAsync()
      if (!perm.granted) {
        Alert.alert("需要麦克风权限", "请在系统设置中允许麦克风与语音识别。")
        return false
      }
      transcriptRef.current = ""
      setListening(true)
      mod.start({ lang: "zh-CN", interimResults: true, continuous: false })
      return true
    } catch {
      setListening(false)
      Alert.alert("语音暂不可用", "请打字输入。")
      return false
    }
  }

  async function stop(): Promise<string> {
    try {
      moduleRef.current?.stop()
    } catch {
      // ignore
    }
    setListening(false)
    await new Promise((r) => setTimeout(r, 280))
    return transcriptRef.current.trim()
  }

  function abort() {
    try {
      moduleRef.current?.abort()
    } catch {
      // ignore
    }
    transcriptRef.current = ""
    setListening(false)
  }

  return { available, listening, start, stop, abort }
}

export const AiVoiceOverlay = forwardRef<AiVoiceOverlayHandle, { holding: boolean }>(
  function AiVoiceOverlay({ holding }, ref): ReactElement {
    const router = useRouter()
    const [visible, setVisible] = useState(false)
    const [hint, setHint] = useState(false)
    const [draft, setDraft] = useState("")
    const [turns, setTurns] = useState<Turn[]>([])
    const [busy, setBusy] = useState(false)
    const [exportingFormat, setExportingFormat] = useState<null | "docx" | "pdf">(null)
    const [showType, setShowType] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const scrollRef = useRef<{ scrollToEnd: (opts?: { animated?: boolean }) => void } | null>(null)
    const [keyboardHeight, setKeyboardHeight] = useState(0)
    const BALL_CLEARANCE = 96
    const voice = useVoiceInput()
    const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pulse = useRef(new Animated.Value(0)).current
    const turnsRef = useRef<Turn[]>([])
    turnsRef.current = turns

    useEffect(
      () => () => {
        abortRef.current?.abort()
        if (hintTimer.current) clearTimeout(hintTimer.current)
      },
      [],
    )

    useEffect(() => {
      if (!holding) {
        pulse.stopAnimation()
        pulse.setValue(0)
        return
      }
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 520, useNativeDriver: true }),
        ]),
      )
      loop.start()
      return () => loop.stop()
    }, [holding, pulse])

    useEffect(() => {
      const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
      const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"
      const onShow = Keyboard.addListener(showEvt, (e) => {
        setKeyboardHeight(e.endCoordinates?.height ?? 0)
      })
      const onHide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0))
      return () => {
        onShow.remove()
        onHide.remove()
      }
    }, [])

    function updateLastAssistant(mutator: (content: string) => string) {
      setTurns((current) => {
        const next = current.slice()
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === "assistant") {
            next[i] = { ...next[i], content: mutator(next[i].content) }
            break
          }
        }
        return next
      })
    }

    async function handleFundPerformance(query: string) {
      const variants = fundSearchVariants(query)
      let hit: Awaited<ReturnType<typeof searchFunds>>["products"][number] | undefined
      for (const q of variants) {
        const result = await searchFunds(q)
        if (result.products[0]) {
          hit = result.products[0]
          break
        }
      }
      if (!hit) {
        updateLastAssistant(
          () => `没有找到与「${query}」匹配的产品，请换一个更准确的名称或备案号。`,
        )
        return
      }
      const name = displayFundName(hit.product_name, hit.short_name)
      const fundCode = String(hit.beian_hao || "").trim()
      const path = `/fund/${encodeURIComponent(fundCode)}`
      updateLastAssistant(
        () => `已找到「${name}」（${fundCode}），正在打开产品页…`,
      )
      setTurns((current) => {
        const next = current.slice()
        const last = next[next.length - 1]
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            linkPath: path,
            linkLabel: `查看 ${name}`,
            fundCode,
          }
        }
        return next
      })
      // Close sheet first, then open fund with explicit params (avoids empty/[code] races on Huawei).
      setTimeout(() => {
        setVisible(false)
        setShowType(false)
        setHint(false)
        router.push({ pathname: "/fund/[code]", params: { code: fundCode } } as never)
      }, 280)
    }

    async function handleTeamBackground(keyword: string, signal: AbortSignal) {
      let report = ""
      let hadError = false
      await streamResearch(
        "team-background",
        { keyword, kbPath: "" },
        (event) => {
          if (event.type === "report_text") {
            const delta = String(event.delta ?? "")
            if (delta) {
              report += delta
              const snapshot = report
              updateLastAssistant(() => snapshot)
            }
          } else if (event.type === "step_start") {
            const title = String(event.title ?? event.step ?? "")
            if (!report) {
              updateLastAssistant((c) => (c.includes("\u6b63\u5728") ? c + "\n\u2022 " + title : c))
            }
          } else if (event.type === "error") {
            hadError = true
            updateLastAssistant(() => String(event.message ?? "\u7814\u7a76\u5931\u8d25"))
          }
        },
        signal,
      )
      if (!hadError && !report.trim()) {
        updateLastAssistant((c) => c || "\u672a\u627e\u5230\u5339\u914d\u7ed3\u679c")
      }
    }

    async function handleManagerProfile(managerName: string, signal: AbortSignal) {
      let resolved = prepareVoiceQuery(managerName).text.trim() || managerName.trim()
      // API fuzzy: searchFunds managers, then pick best near-miss.
      try {
        const found = await searchFunds(resolved)
        const apiNames = (found.managers || [])
          .map((m) => String(m.manager_name || "").trim())
          .filter((n) => n.length >= 2)
        const hits = fuzzyMatchManagers(resolved, apiNames)
        if (hits[0] && hits[0].score >= 0.72) {
          if (hits[1] && hits[0].score - hits[1].score < 0.08 && hits[0].score < 0.95) {
            updateLastAssistant(
              () => `语音可能听成了「${managerName}」。请选择要分析的管理人：`,
            )
            setTurns((current) => {
              const next = current.slice()
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i].role === "assistant") {
                  next[i] = {
                    ...next[i],
                    pickCandidates: hits.slice(0, 4).map((h) => h.name),
                  }
                  break
                }
              }
              return next
            })
            return
          }
          resolved = hits[0].name
        } else if (apiNames[0] && resolved.length >= 2) {
          // Prefer API hit that contains corrected token (e.g. 幻方 → 宁波幻方量化投资...).
          const token = resolved.length <= 4 ? resolved : resolved.slice(0, 4)
          const prefer = apiNames.find((n) => n.includes(token)) || apiNames[0]
          if (prefer) resolved = prefer
        }
      } catch {
        // keep resolved
      }
      if (resolved !== managerName) {
        updateLastAssistant(() => `已将「${managerName}」匹配为「${resolved}」，正在生成管理人画像…`)
      }
      let report = ""
      let hadError = false
      await streamResearch(
        "manager-profile",
        { managerName: resolved, kbPath: "" },
        (event) => {
          if (event.type === "report_text") {
            const delta = String(event.delta ?? "")
            if (delta) {
              report += delta
              const snapshot = report
              updateLastAssistant(() => snapshot)
            }
          } else if (event.type === "step_start") {
            const title = String(event.title ?? event.step ?? "")
            if (!report) {
              updateLastAssistant((c) => (c.includes("正在") ? c + "\n· " + title : c))
            }
          } else if (event.type === "error") {
            hadError = true
            updateLastAssistant(() => String(event.message ?? "研究失败"))
          }
        },
        signal,
      )
      if (!hadError && report.trim()) {
        setTurns((current) => {
          const next = current.slice()
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === "assistant") {
              next[i] = {
                ...next[i],
                content: report,
                exportManagerName: resolved,
                exportMarkdown: report,
              }
              break
            }
          }
          return next
        })
      }
    }

    async function handleKnowledge(question: string, history: Turn[], signal: AbortSignal) {
      const preparedQ = prepareVoiceQuery(question)
      const q = preparedQ.text.trim() || question
      const hist = history
        .filter((t) => t.content.trim())
        .map((t) => ({ role: t.role, content: t.content }))
      await streamKnowledge(
        {
          question: q,
          history: hist,
          stream: true,
          modelMode: "plus",
          useBm25: true,
          title: "全部资料",
        },
        (event) => {
          if (event.type === "text") {
            const delta = String(event.delta ?? "")
            if (!delta) return
            updateLastAssistant((c) => {
              if (c === "正在检索知识库…" || c === "正在思考…") return delta
              return c + delta
            })
          } else if (event.type === "error") {
            updateLastAssistant(() => String(event.message ?? "提问失败"))
          }
        },
        signal,
      )
    }

    async function handleAssistant(messages: Turn[], signal: AbortSignal) {
      await streamAssistantChat(
        {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          pageContext: "当前页面：手机 App AI 助手。可导航到私募基金、MOM、行情、知识库、研究员、全天候。",
        },
        {
          onDelta: (delta) => {
            updateLastAssistant((c) => {
              if (c === "正在思考…" || c === "正在检索知识库…") return delta
              return c + delta
            })
          },
          onNavigate: (nav) => {
            const mapped = mapChatHrefToMobile(nav.href, nav.title)
            if (!mapped) return
            setTurns((current) => {
              const next = current.slice()
              const last = next[next.length - 1]
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  linkPath: mapped.path,
                  linkLabel: `打开 ${mapped.label}`,
                  content: last.content || `正在打开${mapped.label}…`,
                }
              }
              return next
            })
          },
        },
        signal,
      )
    }

    async function send(text?: string) {
      const rawIn = (text ?? draft).trim()
      if (!rawIn || busy) return
      const prepared = prepareVoiceQuery(rawIn)
      const trimmed = prepared.text.trim() || rawIn
      if (prepared.ambiguous && prepared.candidates.length >= 2) {
        setDraft("")
        setVisible(true)
        setTurns((current) => [
          ...current,
          { role: "user", content: trimmed },
          {
            role: "assistant",
            content: `语音可能听成了「${prepared.normalized || rawIn}」。请选择最接近的名称：`,
            pickCandidates: prepared.candidates.map((c) => c.name),
          },
        ])
        return
      }
      const intent = classifyAiIntent(trimmed)
      const userTurn: Turn = {
        role: "user",
        content: prepared.replacements.length
          ? `${trimmed}`
          : trimmed,
      }
      const ack = intentAck(intent)
      setDraft("")
      setVisible(true)
      const prior = turnsRef.current
      setTurns((current) => [...current, userTurn, { role: "assistant", content: ack }])
      setBusy(true)
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        if (intent.kind === "navigate") {
          updateLastAssistant(() => `好的，可以打开${intent.label}。`)
          setTurns((current) => {
            const next = current.slice()
            const last = next[next.length - 1]
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                linkPath: intent.path,
                linkLabel: `打开 ${intent.label}`,
              }
            }
            return next
          })
        } else if (intent.kind === "fund-performance") {
          await handleFundPerformance(intent.query)
        } else if (intent.kind === "manager-profile") {
          await handleManagerProfile(intent.managerName, controller.signal)
        } else if (intent.kind === "team-background") {
          await handleTeamBackground(intent.keyword, controller.signal)
        } else if (intent.kind === "knowledge") {
          const history = [...prior, userTurn]
          await handleKnowledge(intent.question, history, controller.signal)
        } else {
          const history = [...prior, userTurn]
          await handleAssistant(history, controller.signal)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const aborted =
          (err instanceof Error && err.name === "AbortError") ||
          /abort|aborted|cancel+ed|Fetch request has been canceled/i.test(msg)
        if (!aborted) {
          updateLastAssistant(() => msg || "请求失败")
        } else {
          updateLastAssistant((c) =>
            c.startsWith("正在") || c.includes("…") || c.includes("...")
              ? "已取消"
              : c,
          )
        }
      } finally {
        setBusy(false)
      }
    }


    async function handleExportReport(turn: Turn, format: "docx" | "pdf") {
      if (!turn.exportMarkdown || !turn.exportManagerName || exportingFormat) return
      setExportingFormat(format)
      try {
        const name = await exportAndShareManagerReport({
          markdown: turn.exportMarkdown,
          managerName: turn.exportManagerName,
          format,
        })
        Alert.alert("已生成", name + "\n可在分享面板选择微信发送")
      } catch (err) {
        Alert.alert("导出失败", err instanceof Error ? err.message : "请稍后重试")
      } finally {
        setExportingFormat(null)
      }
    }

    useImperativeHandle(ref, () => ({
      beginHold() {
        setHint(false)
        void voice.start()
      },
      async endHold() {
        const text = await voice.stop()
        if (!text) {
          setShowType(true)
          setVisible(true)
          return "empty"
        }
        setVisible(true)
        await send(text)
        return "sent"
      },
      cancelHold() {
        voice.abort()
      },
      showHint() {
        setHint(true)
        if (hintTimer.current) clearTimeout(hintTimer.current)
        hintTimer.current = setTimeout(() => setHint(false), 1600)
      },
      async ask(text: string) {
        const trimmed = text.trim()
        if (!trimmed) {
          setShowType(true)
          setVisible(true)
          return
        }
        setVisible(true)
        await send(trimmed)
      },
      openTypeHint() {
        setShowType(true)
        setVisible(true)
      },
    }))

    function close() {
      abortRef.current?.abort()
      setVisible(false)
      setShowType(false)
      setHint(false)
    }

    const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] })

    return (
      <>
        {(hint || holding) ? (
          <View pointerEvents="none" style={styles.floatLayer}>
            {hint ? (
              <View style={styles.hintToast}>
                <Text style={styles.hintToastText}>长按说话</Text>
              </View>
            ) : null}
            {holding ? (
              <View style={styles.holdBadge}>
                <Animated.View
                  style={[
                    styles.holdPulse,
                    { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
                  ]}
                />
                <Text style={styles.holdBadgeText}>正在录音… 松手发送</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {visible ? (
          <View
            style={[styles.modalRoot, { paddingBottom: keyboardHeight > 0 ? keyboardHeight : BALL_CLEARANCE }]}
            pointerEvents="box-none"
          >
            <Pressable
              style={[styles.backdrop, { bottom: keyboardHeight > 0 ? keyboardHeight : BALL_CLEARANCE }]}
              onPress={close}
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={0}
              style={styles.sheetWrap}
              pointerEvents="box-none"
            >
              <View style={styles.sheet}>
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle}>AI 助手</Text>
                  <Pressable onPress={close} hitSlop={12}>
                    <Text style={styles.close}>关闭</Text>
                  </Pressable>
                </View>
                <Text style={styles.sheetLead}>长按底栏 AI 球说话；松手后回答会出现在这里。</Text>

                <ScrollView
                  ref={scrollRef as never}
                  style={styles.flex}
                  contentContainerStyle={styles.chat}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                >
                  {turns.length === 0 ? (
                    <Text style={styles.empty}>还没有对话。长按 AI 球开始说话。</Text>
                  ) : null}
                  {turns.map((turn, index) => (
                    <View
                      key={`${turn.role}-${index}`}
                      style={turn.role === "user" ? styles.userBubble : styles.answer}
                    >
                                            {turn.role === "user" ? (
                        <Text style={styles.userText}>{turn.content}</Text>
                      ) : (
                        <MarkdownAnswer content={turn.content} placeholder={busy ? "…" : ""} />
                      )}
                      {turn.linkPath || turn.fundCode ? (
                        <Pressable
                          style={styles.linkBtn}
                          onPress={() => {
                            const code = (turn.fundCode || "").trim()
                            // Abort in-flight AI streams only; do not cancel the upcoming fund fetch.
                            abortRef.current?.abort()
                            setVisible(false)
                            setShowType(false)
                            setHint(false)
                            requestAnimationFrame(() => {
                              if (code) {
                                router.push({ pathname: "/fund/[code]", params: { code } } as never)
                              } else if (turn.linkPath) {
                                router.push(turn.linkPath as never)
                              }
                            })
                          }}
                        >
                          <Text style={styles.linkText}>{turn.linkLabel || "打开"}</Text>
                        </Pressable>
                      ) : null}
                      
                      {turn.pickCandidates && turn.pickCandidates.length > 0 && !busy ? (
                        <View style={styles.pickRow}>
                          {turn.pickCandidates.map((name) => (
                            <Pressable
                              key={name}
                              style={styles.pickChip}
                              onPress={() => {
                                void send(name.includes("管理人") ? name : `帮我分析一下${name}这家管理人`)
                              }}
                            >
                              <Text style={styles.pickChipText}>{name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}

                      {turn.exportMarkdown && turn.exportManagerName && !busy ? (
                        <View style={styles.exportRow}>
                          <Pressable
                            style={[styles.exportBtn, exportingFormat === "docx" && styles.exportBtnBusy]}
                            disabled={!!exportingFormat}
                            onPress={() => void handleExportReport(turn, "docx")}
                          >
                            <Text style={styles.exportText}>
                              {exportingFormat === "docx" ? "生成中…" : "导出 Word"}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[styles.exportBtn, exportingFormat === "pdf" && styles.exportBtnBusy]}
                            disabled={!!exportingFormat}
                            onPress={() => void handleExportReport(turn, "pdf")}
                          >
                            <Text style={styles.exportText}>
                              {exportingFormat === "pdf" ? "生成中…" : "导出 PDF"}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ))}
                  {busy ? <ActivityIndicator color="#E7C98A" style={{ marginTop: 8 }} /> : null}
                </ScrollView>

                {showType ? (
                  <View style={styles.composer}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="语音未识别，可打字补充"
                      placeholderTextColor="#A39E96"
                      style={styles.input}
                      editable={!busy}
                      autoFocus
                      onFocus={() => {
                        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
                        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)
                      }}
                      onSubmitEditing={() => void send()}
                      returnKeyType="send"
                    />
                    <Pressable
                      onPress={() => (busy ? abortRef.current?.abort() : void send())}
                      hitSlop={8}
                    >
                      <Text style={styles.send}>{busy ? "停止" : "发送"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable style={styles.typeToggle} onPress={() => setShowType(true)}>
                    <Text style={styles.typeToggleText}>打字输入</Text>
                  </Pressable>
                )}
              </View>
            </KeyboardAvoidingView>
          </View>
        ) : null}
      </>
    )
  },
)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floatLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 110,
  },
  hintToast: {
    alignItems: "center",
  },
  hintToastText: {
    backgroundColor: "rgba(26,24,20,0.88)",
    color: "#FFF6E8",
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
  holdBadge: {
    alignItems: "center",
  },
  holdPulse: {
    position: "absolute",
    width: 160,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#B42318",
  },
  holdBadgeText: {
    color: "#FFF6E8",
    backgroundColor: "rgba(180,35,24,0.92)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    overflow: "hidden",
  },
  // Sheet lifts via paddingBottom = keyboardHeight (or BALL_CLEARANCE when keyboard hidden)
  modalRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    zIndex: 60,
      },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(10,12,18,0.45)",
  },
  sheetWrap: {
    height: "90%",
    maxHeight: "90%",
    zIndex: 61,
  },
  sheet: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 4,
    borderRadius: 20,
    backgroundColor: "rgba(18,22,32,0.94)",
    borderWidth: 1,
    borderColor: "rgba(231,201,138,0.28)",
    paddingTop: 14,
    paddingBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  sheetTop: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
  },
  sheetTitle: {
    color: "#E7C98A",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  close: { color: "#C8C2B8", fontSize: 15, fontWeight: "700" },
  sheetLead: {
    color: "#9A958C",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 16,
    flexShrink: 0,
  },
  chat: { paddingHorizontal: 16, paddingBottom: 16, gap: 14, flexGrow: 1 },
  empty: { color: "#8A857C", fontSize: 16, lineHeight: 26, marginTop: 16 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: "rgba(231,201,138,0.18)",
    borderWidth: 1,
    borderColor: "rgba(231,201,138,0.35)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  userText: { color: "#FFF6E8", fontSize: 16, lineHeight: 26 },
  answer: { alignSelf: "stretch", gap: 10 },
  answerText: { color: "#F3F0EA", fontSize: 16.5, lineHeight: 27 },
  linkBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#E7C98A",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  linkText: { color: "#E7C98A", fontWeight: "700", letterSpacing: 0.6, fontSize: 15 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexShrink: 0,
  },
  input: { flex: 1, fontSize: 16, color: "#F3F0EA", paddingVertical: 6 },
  send: { color: "#E7C98A", fontWeight: "700", letterSpacing: 1, fontSize: 15 },
  typeToggle: { alignItems: "center", paddingVertical: 6, flexShrink: 0 },
  typeToggleText: { color: "#9A958C", fontSize: 12, letterSpacing: 0.8 },
  exportRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  exportBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(231,201,138,0.55)",
    backgroundColor: "rgba(231,201,138,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  exportBtnBusy: { opacity: 0.6 },
  exportText: { color: "#E7C98A", fontWeight: "700", letterSpacing: 0.6, fontSize: 14 },

  pickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  pickChip: {
    backgroundColor: "#1F1A16",
    borderColor: "#C7A56A",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pickChipText: {
    color: "#F5E6C8",
    fontSize: 13,
    fontWeight: "600",
  },
})
