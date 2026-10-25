import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from "react-native-svg"
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition"
import { ENABLE_FUNASR_STT, ENABLE_VOSK_STT } from "@/feature-flags"
import {
  cancelFunAsr,
  createFunAsrEmitter,
  isFofFunAsrAvailable,
  prepareFunAsr,
  requestFunAsrMicPermission,
  startFunAsr,
  stopFunAsr,
} from "@/native/fof-funasr-stt"
import {
  cancelVosk,
  createVoskEmitter,
  isFofVoskAvailable,
  prepareVosk,
  requestVoskMicPermission,
  startVosk,
  stopVosk,
} from "@/native/fof-vosk-stt"
import { prepareVoiceQuery } from "@/voice-normalize"
import { colors } from "@/theme"

type Phase = "idle" | "listening" | "finishing"

/**
 * Prefer Chinese OEM STT — Google is often broken/offline on CN devices.
 * Huawei Xiaoyi package is typically com.huawei.vassistant.
 */
const CN_SPEECH_HINTS = [
  "huawei",
  "hiassistant",
  "vassistant",
  "msdp.speech",
  "iflytek",
  "xiaomi",
  "miui",
  "mibrain",
  "vivo",
  "coloros",
  "heytap",
  "oplus",
  "oppo",
  "samsung",
  "bixby",
  "meizu",
  "baidu",
  "tencent",
]

function listSpeechPackages(): string[] {
  if (Platform.OS !== "android") return []
  try {
    return ExpoSpeechRecognitionModule.getSpeechRecognitionServices?.() ?? []
  } catch {
    return []
  }
}

function pickRecognitionPackage(exclude?: string): string | undefined {
  if (Platform.OS !== "android") return undefined
  try {
    const services = listSpeechPackages().filter((p) => p && p !== exclude)
    const def = ExpoSpeechRecognitionModule.getDefaultRecognitionService()?.packageName?.trim()
    const hw = services.filter((p) => /huawei|vassistant|hiassistant|msdp\.speech/i.test(p))
    const ranked = [
      ...hw,
      ...services.filter((p) => CN_SPEECH_HINTS.some((h) => p.toLowerCase().includes(h))),
      ...(def && def !== exclude && !services.includes(def) ? [def] : []),
      ...services.filter((p) => !p.includes("google")),
      ...services,
    ]
    const seen = new Set<string>()
    for (const p of ranked) {
      if (!p || seen.has(p)) continue
      seen.add(p)
      return p
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Root-cause note (Huawei / OEM):
 * expo-speech-recognition with continuous=true on Android 13+ injects
 * EXTRA_AUDIO_SOURCE + EXTRA_SEGMENTED_SESSION (Google-oriented). Xiaoyi often
 * starts listening (UI shows 识别中) but never emits interim/final transcripts,
 * so short phrases like「你好」finish as 语音未识别.
 * Hold-to-talk already restarts on "end", so continuous is unnecessary on Android.
 */

function isHuaweiSpeechPkg(pkg?: string) {
  const p = (pkg || "").toLowerCase()
  return p.includes("huawei") || p.includes("vassistant") || p.includes("hiassistant") || p.includes("msdp.speech")
}

function buildStartOptions(pkg?: string, mode: "full" | "minimal" = "full") {
  // Always false on Android — avoid EXTRA_AUDIO_SOURCE path that breaks Xiaoyi.
  const continuous = Platform.OS !== "android" ? true : false
  // web_search is recommended by Google for short prompts; free_form is safer on OEMs.
  // Use free_form by default; minimal retry keeps only LANGUAGE_MODEL.
  const androidIntentOptions =
    mode === "minimal"
      ? {
          EXTRA_LANGUAGE_MODEL: "free_form" as const,
          EXTRA_MAX_RESULTS: 3,
        }
      : {
          EXTRA_LANGUAGE_MODEL: "free_form" as const,
          EXTRA_MAX_RESULTS: 3,
          // Generous silence so short phrases commit while still holding.
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2500,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 400,
        }
  return {
    lang: "zh-CN",
    interimResults: true,
    continuous,
    addsPunctuation: false,
    maxAlternatives: 3,
    ...(pkg ? { androidRecognitionServicePackage: pkg } : {}),
    volumeChangeEventOptions: Platform.OS === "ios" ? { enabled: true, intervalMillis: 200 } : { enabled: false },
    androidIntentOptions,
  }
}

const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
  "network",
  "audio-capture",
  "client",
])

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

type VoiceBallProps = {
  /** When set, recognized text goes here (home overlay router) instead of /knowledge. */
  onTranscript?: (text: string) => void
  onEmptyTranscript?: () => void
}

export function VoiceBall({ onTranscript, onEmptyTranscript }: VoiceBallProps = {}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("idle")
  const [liveText, setLiveText] = useState("")
  const [hint, setHint] = useState("按住说话")
  const [volumeHint, setVolumeHint] = useState("")

  const holdingRef = useRef(false)
  const finalsRef = useRef<string[]>([])
  const interimRef = useRef("")
  const phaseRef = useRef<Phase>("idle")
  const finishedRef = useRef(false)
  const servicePkgRef = useRef<string | undefined>(undefined)
  const intentModeRef = useRef<"full" | "minimal">("full")
  const triedPkgsRef = useRef<string[]>([])
  const restartingRef = useRef(false)
  const gotResultRef = useRef(false)
  const gotAudioRef = useRef(false)
  const gotSpeechRef = useRef(false)
  const startAttemptsRef = useRef(0)
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulse = useRef(new Animated.Value(0)).current
  const useFunAsrRef = useRef(false)
  const useVoskRef = useRef(false)
  const voskUnsubsRef = useRef<Array<() => void>>([])
  const funAsrUnsubsRef = useRef<Array<() => void>>([])

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const composed = useCallback(() => {
    const parts = [...finalsRef.current]
    const interim = interimRef.current.trim()
    if (interim) parts.push(interim)
    return parts.join("").trim()
  }, [])

  const syncLive = useCallback(() => {
    setLiveText(composed())
  }, [composed])

  const abortQuiet = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.abort()
    } catch {
      // ignore
    }
  }, [])

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current)
      finishTimerRef.current = null
    }
  }, [])

  const startRecognizer = useCallback(
    (reason: string) => {
      if (!holdingRef.current) return
      try {
        restartingRef.current = true
        startAttemptsRef.current += 1
        const pkg = servicePkgRef.current
        const mode = isHuaweiSpeechPkg(pkg) ? "minimal" : intentModeRef.current
        ExpoSpeechRecognitionModule.start(
          buildStartOptions(pkg, mode),
        )
      } catch (err) {
        if (holdingRef.current && startAttemptsRef.current <= 1) {
          holdingRef.current = false
          setPhaseBoth("idle")
          setHint("按住说话")
          Alert.alert(
            "无法开始识别",
            err instanceof Error
              ? err.message
              : `启动失败（${reason}）。请检查系统语音识别是否可用。`,
          )
        }
      } finally {
        setTimeout(() => {
          restartingRef.current = false
        }, 280)
      }
    },
    [setPhaseBoth],
  )

  useEffect(() => {
    if (phase !== "listening") {
      pulse.stopAnimation()
      pulse.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [phase, pulse])

  useEffect(() => () => clearFinishTimer(), [clearFinishTimer])

  useSpeechRecognitionEvent("audiostart", () => {
    gotAudioRef.current = true
    if (holdingRef.current) setVolumeHint((v) => v || "麦克风已打开…")
  })

  useSpeechRecognitionEvent("speechstart", () => {
    gotSpeechRef.current = true
    if (holdingRef.current) setVolumeHint("正在听…")
  })

  useSpeechRecognitionEvent("result", (event) => {
    if (!holdingRef.current && phaseRef.current !== "finishing") return
    // Prefer first non-empty alternative (some OEMs put text on later slots).
    const alts = event.results ?? []
    let transcript = ""
    for (const r of alts) {
      const t = (r?.transcript ?? "").trim()
      if (t) {
        transcript = t
        break
      }
    }
    if (!transcript) return
    gotResultRef.current = true
    gotSpeechRef.current = true
    if (event.isFinal) {
      finalsRef.current = [...finalsRef.current, transcript]
      interimRef.current = ""
    } else {
      interimRef.current = transcript
    }
    syncLive()
    // If user already released, finalize as soon as we have text.
    if (phaseRef.current === "finishing" && event.isFinal) {
      finishWithText(composed())
    }
  })

  useSpeechRecognitionEvent("volumechange", (event) => {
    if (!holdingRef.current) return
    if (typeof event.value === "number" && event.value >= -1) {
      // OEM rms scales differ; any callback usually means mic path is live.
      setVolumeHint("已听到声音…")
      if (event.value > 0) gotSpeechRef.current = true
    }
  })

  useSpeechRecognitionEvent("nomatch", () => {
    // Soft: ignore while holding (we'll restart). While finishing, let grace timer decide.
    if (holdingRef.current && !restartingRef.current) {
      startRecognizer("after-nomatch")
    }
  })

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") return

    if (holdingRef.current) {
      if (event.error === "no-speech" || event.error === "speech-timeout" || event.error === "busy") {
        if (!restartingRef.current) {
          void (async () => {
            await sleep(event.error === "busy" ? 400 : 120)
            if (holdingRef.current) startRecognizer("after-silence")
          })()
        }
        return
      }
      // OEM missing RecognizerIntent fields / audio-capture — strip optional extras, then try another package.
      if (
        event.error === "audio-capture" ||
        event.error === "client" ||
        /No field|EXTRA_/i.test(event.message || "")
      ) {
        if (intentModeRef.current !== "minimal" && startAttemptsRef.current < 4) {
          intentModeRef.current = "minimal"
          abortQuiet()
          void (async () => {
            await sleep(300)
            if (holdingRef.current) startRecognizer("retry-minimal-extras")
          })()
          return
        }
        const next = pickRecognitionPackage(servicePkgRef.current)
        const alreadyTried = triedPkgsRef.current
        if (next && !alreadyTried.includes(next) && startAttemptsRef.current < 4) {
          triedPkgsRef.current = [...alreadyTried, servicePkgRef.current || "", next].filter(Boolean)
          servicePkgRef.current = next
          abortQuiet()
          void (async () => {
            await sleep(350)
            if (holdingRef.current) startRecognizer("retry-package")
          })()
          return
        }
      }

      if (FATAL_ERRORS.has(event.error)) {
        const hadText = Boolean(composed())
        holdingRef.current = false
        setPhaseBoth("idle")
        setHint("按住说话")
        if (hadText) {
          finishWithText(composed())
          return
        }
        setLiveText("")
        const svc = servicePkgRef.current || "系统默认"
        const pkgs = listSpeechPackages()
        const messages: Record<string, string> = {
          "not-allowed": "请在系统设置中允许本应用使用麦克风，然后重试。",
          "service-not-allowed": `语音识别服务不可用（${svc}）。国产机请确认已开启系统语音识别/小艺助手。`,
          "language-not-supported":
            "当前识别引擎不支持中文。请在系统语音设置中下载中文语音包，或更换默认语音识别服务。",
          network: "识别需要网络，但当前无法连接识别服务。请检查网络后重试。",
          "audio-capture": [
            "录音启动失败。",
            `当前识别服务：${svc}`,
            pkgs.length ? `可用服务：${pkgs.slice(0, 3).join(", ")}` : "未检测到识别服务。",
            event.message ? `详情：${event.message}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          client: `识别客户端错误（${svc}）。请确认系统语音服务已启用，然后重试。`,
        }
        Alert.alert("语音识别失败", messages[event.error] || `${event.error}: ${event.message || ""}`)
      }
      return
    }
    if (phaseRef.current === "finishing") {
      // Soften: no-speech/timeout after stop often means OEM dropped the short utterance.
      // Wait for grace timer / late result instead of instantly clearing.
      if (event.error === "no-speech" || event.error === "speech-timeout") {
        const text = composed()
        if (text) finishWithText(text)
        return
      }
      const text = composed()
      if (text) finishWithText(text)
    }
  })

  useSpeechRecognitionEvent("end", () => {
    if (holdingRef.current) {
      if (!restartingRef.current) startRecognizer("after-end")
      return
    }
    if (phaseRef.current === "finishing") {
      const text = composed()
      if (text) finishWithText(text)
      // else: keep waiting for late onResults within grace window
    }
  })

  function finishWithText(text: string) {
    if (finishedRef.current) return
    finishedRef.current = true
    clearFinishTimer()
    setPhaseBoth("idle")
    setHint("按住说话")
    setVolumeHint("")
    finalsRef.current = []
    interimRef.current = ""
    const trimmed = text.trim()
    if (!trimmed) {
      setLiveText("")
      // Soften false negative when mic/speech activity was observed.
      const soft =
        gotSpeechRef.current || gotAudioRef.current
          ? "未听清，请再说一次"
          : "语音未识别"
      setHint(soft)
      setTimeout(() => setHint((h) => (h === soft ? "按住说话" : h)), 2000)
      onEmptyTranscript?.()
      return
    }
    setLiveText("")
    if (onTranscript) {
      const prepared = prepareVoiceQuery(trimmed)
      onTranscript(prepared.text.trim() || trimmed)
      return
    }
    // Fallback if overlay is not wired (should not happen on tab bar).
    router.push({ pathname: "/knowledge", params: { q: trimmed, ask: "1" } })
  }


  function clearVoskListeners() {
    for (const u of voskUnsubsRef.current) {
      try { u() } catch { /* ignore */ }
    }
    voskUnsubsRef.current = []
  }

  function clearFunAsrListeners() {
    for (const u of funAsrUnsubsRef.current) {
      try { u() } catch { /* ignore */ }
    }
    funAsrUnsubsRef.current = []
  }

  async function beginHold() {
    if (holdingRef.current) return
    holdingRef.current = true
    finishedRef.current = false
    gotResultRef.current = false
    gotAudioRef.current = false
    gotSpeechRef.current = false
    startAttemptsRef.current = 0
    triedPkgsRef.current = []
    intentModeRef.current = "full"
    finalsRef.current = []
    interimRef.current = ""
    clearFinishTimer()
    clearVoskListeners()
    clearFunAsrListeners()

    // FunASR Paraformer streaming (sherpa-onnx) — primary on-device STT.
    useFunAsrRef.current =
      ENABLE_FUNASR_STT && Platform.OS === "android" && isFofFunAsrAvailable()
    if (useFunAsrRef.current) {
      setLiveText("")
      setHint("松开提问")
      setVolumeHint("")
      setPhaseBoth("listening")
      try {
        const micOk = await requestFunAsrMicPermission()
        if (!micOk) {
          holdingRef.current = false
          useFunAsrRef.current = false
          setPhaseBoth("idle")
          setHint("按住说话")
          Alert.alert("需要麦克风权限", "请允许麦克风权限，才能按住说话提问。")
          return
        }
        if (!holdingRef.current) {
          useFunAsrRef.current = false
          return
        }
        setLiveText("模型准备中…")
        await prepareFunAsr()
        if (!holdingRef.current) {
          useFunAsrRef.current = false
          await cancelFunAsr()
          return
        }
        const emitter = createFunAsrEmitter()
        if (emitter) {
          const onPartial = emitter.addListener("onPartial", (ev: { text?: string }) => {
            const txt = (ev?.text || "").trim()
            interimRef.current = txt
            setLiveText(composed() || txt || "…")
            if (txt) {
              gotSpeechRef.current = true
              gotResultRef.current = true
            }
          })
          const onResult = emitter.addListener("onResult", (ev: { text?: string; composed?: string }) => {
            const piece = (ev?.text || "").trim()
            if (piece) {
              finalsRef.current = [...finalsRef.current, piece]
              interimRef.current = ""
              gotSpeechRef.current = true
              gotResultRef.current = true
              setLiveText(composed())
            } else if (ev?.composed) {
              setLiveText(String(ev.composed))
            }
          })
          funAsrUnsubsRef.current = [() => onPartial.remove(), () => onResult.remove()]
        }
        await startFunAsr()
        gotAudioRef.current = true
        if (!composed()) setLiveText("…请开始说话")
      } catch (err) {
        holdingRef.current = false
        useFunAsrRef.current = false
        clearFunAsrListeners()
        void cancelFunAsr()
        setPhaseBoth("idle")
        setHint("按住说话")
        Alert.alert("语音启动失败", err instanceof Error ? err.message : String(err))
      }
      return
    }

    // Legacy Vosk (disabled by flag; kept as fallback if re-enabled).
    useVoskRef.current =
      ENABLE_VOSK_STT && Platform.OS === "android" && isFofVoskAvailable()
    if (useVoskRef.current) {
      setLiveText("")
      setHint("松开提问")
      setVolumeHint("")
      setPhaseBoth("listening")
      try {
        const micOk = await requestVoskMicPermission()
        if (!micOk) {
          holdingRef.current = false
          useVoskRef.current = false
          setPhaseBoth("idle")
          setHint("按住说话")
          Alert.alert("需要麦克风权限", "请允许麦克风权限，才能按住说话提问。")
          return
        }
        if (!holdingRef.current) {
          useVoskRef.current = false
          return
        }
        setLiveText("模型准备中…")
        await prepareVosk()
        if (!holdingRef.current) {
          useVoskRef.current = false
          await cancelVosk()
          return
        }
        const emitter = createVoskEmitter()
        if (emitter) {
          const onPartial = emitter.addListener("onPartial", (ev: { text?: string }) => {
            const txt = (ev?.text || "").trim()
            interimRef.current = txt
            setLiveText(composed() || txt || "…")
            if (txt) {
              gotSpeechRef.current = true
              gotResultRef.current = true
            }
          })
          const onResult = emitter.addListener("onResult", (ev: { text?: string; composed?: string }) => {
            const piece = (ev?.text || "").trim()
            if (piece) {
              finalsRef.current = [...finalsRef.current, piece]
              interimRef.current = ""
              gotSpeechRef.current = true
              gotResultRef.current = true
              setLiveText(composed())
            } else if (ev?.composed) {
              setLiveText(String(ev.composed))
            }
          })
          voskUnsubsRef.current = [() => onPartial.remove(), () => onResult.remove()]
        }
        await startVosk()
        gotAudioRef.current = true
        if (!composed()) setLiveText("…请开始说话")
      } catch (err) {
        holdingRef.current = false
        useVoskRef.current = false
        clearVoskListeners()
        void cancelVosk()
        setPhaseBoth("idle")
        setHint("按住说话")
        Alert.alert("语音启动失败", err instanceof Error ? err.message : String(err))
      }
      return
    }

    setLiveText("")
    setVolumeHint("")
    setHint("松开提问")
    setPhaseBoth("listening")

    try {
      // Release any leftover session that may still hold the mic (Huawei ERROR_AUDIO).
      abortQuiet()
      await sleep(200)

      let micOk = false
      try {
        const mic = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()
        if (mic.granted) micOk = true
        else {
          const asked = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()
          micOk = asked.granted
        }
      } catch {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
        micOk = perm.granted
      }
      if (!micOk) {
        const fallback = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
        micOk = fallback.granted
      }
      if (!micOk) {
        holdingRef.current = false
        setPhaseBoth("idle")
        setHint("按住说话")
        Alert.alert("需要麦克风权限", "请允许麦克风与语音识别权限，才能按住说话提问。")
        return
      }

      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        holdingRef.current = false
        setPhaseBoth("idle")
        setHint("按住说话")
        let detail = "当前设备未提供可用的语音识别服务。"
        try {
          const def = ExpoSpeechRecognitionModule.getDefaultRecognitionService()?.packageName
          const list = listSpeechPackages()
          detail += def ? `\n默认服务：${def}` : "\n未检测到默认识别服务。"
          if (list.length) detail += `\n可用：${list.slice(0, 4).join(", ")}`
          else detail += "\n请开启系统语音识别，或安装中文语音引擎后重试。"
        } catch {
          // ignore
        }
        Alert.alert("语音识别不可用", detail)
        return
      }

      servicePkgRef.current = pickRecognitionPackage()
      if (servicePkgRef.current) triedPkgsRef.current = [servicePkgRef.current]

      if (!holdingRef.current) return
      startRecognizer("begin")

      setTimeout(() => {
        if (holdingRef.current && !gotResultRef.current && !composed()) {
          setVolumeHint((v) =>
            v || (gotAudioRef.current ? "正在听…请说话" : "正在听…"),
          )
        }
      }, 2800)
    } catch (err) {
      holdingRef.current = false
      setPhaseBoth("idle")
      setHint("按住说话")
      Alert.alert("无法开始识别", err instanceof Error ? err.message : "请稍后重试")
    }
  }

  function endHold() {
    if (!holdingRef.current && phaseRef.current !== "listening") return
    holdingRef.current = false
    if (useFunAsrRef.current) {
      setPhaseBoth("finishing")
      setHint("识别中…")
      void (async () => {
        try {
          const text = await stopFunAsr()
          useFunAsrRef.current = false
          clearFunAsrListeners()
          finishWithText((text || composed()).trim())
        } catch (err) {
          useFunAsrRef.current = false
          clearFunAsrListeners()
          void cancelFunAsr()
          const fallback = composed()
          if (fallback) finishWithText(fallback)
          else {
            setLiveText(err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80))
            setTimeout(() => finishWithText(""), 1200)
          }
        }
      })()
      return
    }
    if (useVoskRef.current) {
      setPhaseBoth("finishing")
      setHint("识别中…")
      void (async () => {
        try {
          const text = await stopVosk()
          useVoskRef.current = false
          clearVoskListeners()
          finishWithText((text || composed()).trim())
        } catch (err) {
          useVoskRef.current = false
          clearVoskListeners()
          void cancelVosk()
          const fallback = composed()
          if (fallback) finishWithText(fallback)
          else {
            setLiveText(err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80))
            setTimeout(() => finishWithText(""), 1200)
          }
        }
      })()
      return
    }
    setPhaseBoth("finishing")
    setHint("识别中…")
    const already = composed()
    if (already) {
      // Text already captured while holding (common once continuous is off).
      try {
        ExpoSpeechRecognitionModule.stop()
      } catch {
        // ignore
      }
      finishWithText(already)
      return
    }
    try {
      ExpoSpeechRecognitionModule.stop()
    } catch {
      finishWithText(already)
      return
    }
    // Huawei often delivers onResults late after stopListening — wait longer.
    clearFinishTimer()
    finishTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "finishing") finishWithText(composed() || already)
    }, 2800)
  }

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })
  const ring = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] })
  const softFail = hint === "语音未识别" || hint === "未听清，请再说一次"
  const showBubble = phase !== "idle" || Boolean(liveText) || softFail

  return (
    <View style={styles.slot} pointerEvents="box-none">
      {showBubble ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleLabel}>
            {phase === "listening" ? "正在听…" : softFail ? "未识别" : "识别中"}
          </Text>
          <Text style={styles.bubbleText} numberOfLines={4}>
            {liveText ||
              (phase === "listening"
                ? volumeHint || "请开始说话"
                : softFail
                  ? hint
                  : "…")}
          </Text>
        </View>
      ) : null}

      <View style={styles.ballArea}>
        {phase === "listening" ? (
          <Animated.View style={[styles.ring, { opacity: ring, transform: [{ scale }] }]} />
        ) : null}
        <Animated.View style={{ transform: [{ scale: phase === "listening" ? scale : 1 }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="按住说话"
            onPressIn={() => void beginHold()}
            onPressOut={endHold}
            style={[styles.ball, phase === "listening" && styles.ballOn]}
          >
            <View style={styles.orbStack} pointerEvents="none">
              <Svg width={56} height={56} viewBox="0 0 56 56">
                <Defs>
                  <RadialGradient id="aiVoiceOrb" cx="38%" cy="32%" r="70%">
                    <Stop offset="0" stopColor="#FFF8EE" />
                    <Stop offset="0.35" stopColor="#F0D7A8" />
                    <Stop offset="0.62" stopColor="#E7C98A" />
                    <Stop offset="0.82" stopColor="#A67C45" />
                    <Stop offset="1" stopColor="#5A4330" />
                  </RadialGradient>
                </Defs>
                <Circle cx="28" cy="28" r="27" fill="url(#aiVoiceOrb)" />
                <Ellipse cx="20" cy="17" rx="9" ry="6" fill="rgba(255,255,255,0.42)" />
                <Ellipse cx="34" cy="36" rx="14" ry="10" fill="rgba(90,67,48,0.18)" />
              </Svg>
              <Text style={styles.ballMark}>AI</Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  /** Center tab slot — sits in the middle of the bottom menu */
  slot: {
    width: 76,
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: -22,
    zIndex: 20,
  },
  bubble: {
    position: "absolute",
    bottom: 78,
    width: 260,
    maxWidth: 280,
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#1A1814",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 30,
  },
  bubbleLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
  },
  bubbleText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
  },
  ballArea: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(154,123,79,0.35)",
  },
  ball: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#5A4330",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  ballOn: {
    shadowOpacity: 0.72,
    shadowRadius: 16,
  },
  orbStack: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ballMark: {
    position: "absolute",
    color: "#FFF8EE",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
    textShadowColor: "rgba(63,46,28,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
})
