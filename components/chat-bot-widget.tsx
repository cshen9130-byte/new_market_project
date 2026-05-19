"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Bot, Camera, ChevronDown, Crosshair, Loader2, Send, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ── Page context mapping ──────────────────────────────────────────────────────
function getPageContext(path: string): string {
  // ── sub-pages first (most specific) ──────────────────────────────────────
  if (path.includes("/tools/send-email"))
    return "当前页面：【自动发邮件】小工具。功能：为每位投顾配置定时发送任务，每天自动将最新逐日核算单 xlsx 附件发送至指定邮箱。支持多发送配置管理（可分别配置收件人、发送时间、邮件主题/正文、附件占位符[日期]/[投顾代码]/[文件名]）以及 SMTP 发件账号管理（支持腾讯企业邮箱/QQ/163/126/Gmail/Outlook 等）。"
  if (path.includes("/tools/nav-cleaner"))
    return "当前页面：【NAV 净值清洗】小工具。功能：上传基金净值 Excel/CSV 文件，自动检测异常数据、修正格式并导出标准化净值表。"
  if (path.includes("/tools"))
    return "当前页面：【小工具集合】。包含：①自动发邮件（定时将投顾逐日核算单 xlsx 发送给指定收件人）；②NAV 净值清洗（上传并标准化基金净值数据）。"
  if (path.includes("/mom-analysis/carry-calc"))
    return "当前页面：【业绩报酬测算】。根据最新交易日累计盈亏，计算母层与子层业绩报酬及私募基金净业绩报酬。"
  if (path.includes("/mom-analysis/trader-analysis"))
    return "当前页面：【盘手历史交易复盘】。基于客户交易核算日报，按账户汇总期间盈亏、手续费、权益等绩效指标，做盘手绩效评估。"
  if (path.includes("/mom-analysis/data-import"))
    return "当前页面：【数据导入】。上传逐日核算 ZIP 包，自动解压、标准化命名并检查交易日覆盖情况。"
  if (path.includes("/mom-analysis"))
    return "当前页面：【MOM分析】总览。包含四个子功能入口：①MOM 每日风控（在线浏览）；②数据导入（上传逐日核算 ZIP 包）；③盘手历史交易复盘（按账户汇总绩效指标）；④业绩报酬测算（计算母/子层报酬）。"
  if (path.includes("/futures-market"))
    return "当前页面：【期货市场分析】。主要图表与模块：①南华商品指数走势图；②南华板块指数走势（农产品/金属/能化/软商品等板块）；③南华板块指数滚动波动率；④南华板块截面波动率柱状图；⑤南华板块滚动相关性矩阵（热力图）；⑥南华板块滚动相关性走势折线图；⑦【商品期货波动率 vs 南华商品指数相关性】散点图（可选板块、波动率/相关性窗口，每个点代表一个品种，横轴为波动率、纵轴为与 NHCI 的滚动相关性，气泡大小代表成交量，还有相关性分布直方图和滚动相关性走势面板）。"
  if (path.includes("/macro-market"))
    return "当前页面：【宏观市场分析】（国内已实现，全球待开发）。包含三个模块：①PCA 聚类模型 — 基于宏观因子（CPI、PMI、M1、信贷等）的主成分分析双标图，识别当前宏观环境所属聚类及因子载荷；②经济体制相似性模型 — 计算当前宏观指标与历史各时期的欧氏距离，找出最相似的历史宏观环境并展示对应期间资产表现；③货币+信用 周期模型 — 展示货币宽松/收紧与信用扩张/收缩的四象限周期轮动，判断当前所处位置。"
  if (path.includes("/stock-market"))
    return "当前页面：【股票市场分析】。目前展示：主要股指（标普500/纳斯达克/道琼斯）走势、板块表现柱状图（科技/金融/医疗/能源/消费/工业六大板块涨跌幅）、成交量折线图。（数据部分为示例占位数据，实际功能开发中）"
  if (path.includes("/options-market"))
    return "当前页面：【期权市场分析】。目前展示：隐含波动率 vs 已实现波动率走势、期权 Put/Call 比率、期权到期持仓分布。（数据部分为示例占位数据，实际功能开发中）"
  if (path.includes("/private-funds"))
    return "当前页面：【私募基金分析】。目前展示：多只基金累计净值走势对比、基金规模/收益率/夏普比率表格、资产配置饼图。（数据部分为示例占位数据，实际功能开发中）"
  if (path.includes("/ai-knowledge"))
    return "当前页面：【AI 知识库】。整理了与系统相关的市场分析方法论、指标解释、模型说明等知识文档，支持检索与问答。"
  // ── dashboard root / fallback ─────────────────────────────────────────────
  if (path.includes("/ma/dashboard"))
    return "当前页面：【市场总览】仪表盘首页。展示快速导航卡片，入口包括：期货市场、宏观市场、股票市场、期权市场、私募基金、MOM分析、小工具、AI知识库。"
  return "当前页面：市场环境监测系统（MOM 市场监控看板）。"
}
// ── Identify element under cursor (for pin tool) ─────────────────────────────
function identifyElementAt(x: number, y: number): { label: string; el: HTMLElement | null } {
  const all = document.elementsFromPoint(x, y) as HTMLElement[]
  const target = all.find(
    (el) =>
      !el.closest("[data-pinning-overlay]") &&
      !el.closest("[data-chat-box]") &&
      el.tagName !== "HTML" &&
      el.tagName !== "BODY",
  )
  if (!target) return { label: "页面区域", el: null }

  // Walk up to find a meaningful container (card, section, canvas wrapper)
  const container: HTMLElement =
    (target.closest("canvas")?.closest("[class]") as HTMLElement) ??
    (target.closest("[class*='card' i], [class*='Card']") as HTMLElement) ??
    (target.closest("section, article") as HTMLElement) ??
    target

  // Extract label from heading or first non-empty text line
  const heading = container.querySelector("h1,h2,h3,h4")
  if (heading?.textContent?.trim()) return { label: heading.textContent.trim(), el: container }

  const lines = (container.innerText ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
  const label = lines[0]?.slice(0, 60) ?? "页面区域"
  return { label, el: container }
}
// ── Types ─────────────────────────────────────────────────────────────────────
type Message = { role: "user" | "assistant"; content: string }
type Pos = { x: number; y: number }

interface ChatBotWidgetProps {
  visible: boolean
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ChatBotWidget({ visible, onClose }: ChatBotWidgetProps) {
  const pathname = usePathname()
  const [mode, setMode] = useState<"ball" | "chat">("ball")
  const [pos, setPos] = useState<Pos | null>(null)
  const [chatPos, setChatPos] = useState<Pos | null>(null)
  const [chatSize, setChatSize] = useState({ w: 360, h: 500 })
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState("")

  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null)
  const [capturingScreen, setCapturingScreen] = useState(false)

  // ── Pin-to-chart tool state
  const [pinningMode, setPinningMode] = useState(false)
  const [pinLineStart, setPinLineStart] = useState<Pos | null>(null)
  const [pinCursorPos, setPinCursorPos] = useState<Pos | null>(null)
  const [pinnedTarget, setPinnedTarget] = useState<{ label: string; screenshot?: string } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesBoxRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragStartRef = useRef<{ px: number; py: number; bx: number; by: number } | null>(null)
  const dragMovedRef = useRef(false)
  const chatDragStartRef = useRef<{ px: number; py: number; bx: number; by: number } | null>(null)
  const chatDragMovedRef = useRef(false)
  const resizeStartRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const userScrolledUpRef = useRef(false)
  const pinBtnRef = useRef<HTMLButtonElement>(null)
  const chatBoxRef = useRef<HTMLDivElement>(null)

  // Set default ball position on first render (client-only)
  useEffect(() => {
    if (pos === null) {
      setPos({ x: window.innerWidth - 72, y: window.innerHeight - 96 })
    }
  }, [pos])

  // Scroll messages to bottom (only when user hasn't scrolled up)
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, streamContent])

  // Reset userScrolledUp when new user message is sent (handled in sendMessage)
  // Focus textarea when chat opens
  useEffect(() => {
    if (mode === "chat") {
      setTimeout(() => textareaRef.current?.focus(), 80)
    }
  }, [mode])

  // ── Drag handlers ────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pos) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragStartRef.current = { px: e.clientX, py: e.clientY, bx: pos.x, by: pos.y }
      dragMovedRef.current = false
    },
    [pos],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return
      const dx = e.clientX - dragStartRef.current.px
      const dy = e.clientY - dragStartRef.current.py
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMovedRef.current = true
      const newX = Math.max(28, Math.min(window.innerWidth - 28, dragStartRef.current.bx + dx))
      const newY = Math.max(28, Math.min(window.innerHeight - 28, dragStartRef.current.by + dy))
      setPos({ x: newX, y: newY })
    },
    [],
  )

  const onPointerUp = useCallback(() => {
    if (!dragMovedRef.current) {
      // Open chat near ball position, clamped to viewport
      const W = 360, H = 500
      const bx = pos?.x ?? window.innerWidth - 72
      const by = pos?.y ?? window.innerHeight - 96
      const left = Math.max(8, Math.min(window.innerWidth - W - 8, bx - W / 2))
      const top = Math.max(8, Math.min(window.innerHeight - H - 8, by - H))
      setChatPos({ x: left, y: top })
      setMode("chat")
    }
    dragStartRef.current = null
    dragMovedRef.current = false
  }, [pos])

  // ── Chat header drag handlers ────────────────────────────────────────
  const onChatHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!chatPos) return
      e.currentTarget.setPointerCapture(e.pointerId)
      chatDragStartRef.current = { px: e.clientX, py: e.clientY, bx: chatPos.x, by: chatPos.y }
      chatDragMovedRef.current = false
    },
    [chatPos],
  )

  const onChatHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!chatDragStartRef.current) return
      const dx = e.clientX - chatDragStartRef.current.px
      const dy = e.clientY - chatDragStartRef.current.py
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) chatDragMovedRef.current = true
      const W = 360, H = 500
      const newX = Math.max(8, Math.min(window.innerWidth - W - 8, chatDragStartRef.current.bx + dx))
      const newY = Math.max(8, Math.min(window.innerHeight - H - 8, chatDragStartRef.current.by + dy))
      setChatPos({ x: newX, y: newY })
    },
    [],
  )

  const onChatHeaderPointerUp = useCallback(() => {
    chatDragStartRef.current = null
    chatDragMovedRef.current = false
  }, [])

  // ── Resize handlers ────────────────────────────────────────────────────
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, dir: "se" | "s" | "e") => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      resizeStartRef.current = { px: e.clientX, py: e.clientY, w: chatSize.w, h: chatSize.h }
      const onMove = (ev: PointerEvent) => {
        if (!resizeStartRef.current) return
        const dx = ev.clientX - resizeStartRef.current.px
        const dy = ev.clientY - resizeStartRef.current.py
        setChatSize({
          w: dir === "s" ? resizeStartRef.current.w : Math.max(300, resizeStartRef.current.w + dx),
          h: dir === "e" ? resizeStartRef.current.h : Math.max(300, resizeStartRef.current.h + dy),
        })
      }
      const onUp = () => {
        resizeStartRef.current = null
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [chatSize],
  )

  function stopGeneration() {
    abortRef.current?.abort()
  }

  // ── Pin-to-chart ────────────────────────────────────────────────────────────
  function startPinning() {
    if (!pinBtnRef.current) return
    const r = pinBtnRef.current.getBoundingClientRect()
    setPinLineStart({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    setPinCursorPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    setPinningMode(true)
  }

  async function commitPin(x: number, y: number) {
    setPinningMode(false)
    const { label, el } = identifyElementAt(x, y)
    if (!el) { setPinnedTarget({ label }); return }
    try {
      const { toJpeg } = await import("html-to-image")
      const ss = await toJpeg(el, { quality: 0.85, pixelRatio: 0.8, cacheBust: true })
      setPinnedTarget({ label, screenshot: ss })
    } catch {
      setPinnedTarget({ label })
    }
  }

  // ── Screenshot capture ────────────────────────────────────────────────────
  async function captureScreen() {
    setCapturingScreen(true)
    try {
      const { toJpeg } = await import("html-to-image")
      const mainEl = document.querySelector("main") as HTMLElement
      if (!mainEl) return
      const dataUrl = await toJpeg(mainEl, {
        quality: 0.75,
        pixelRatio: 0.6,
        cacheBust: true,
      })
      setPendingScreenshot(dataUrl)
    } catch (e) {
      console.error("Screenshot failed", e)
    } finally {
      setCapturingScreen(false)
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return

    // Reset scroll-up flag so new response auto-scrolls
    userScrolledUpRef.current = false

    const screenshot = pendingScreenshot ?? pinnedTarget?.screenshot ?? null
    setPendingScreenshot(null)
    const pinLabel = pinnedTarget?.label ?? null
    setPinnedTarget(null)

    const pageCtx = pinLabel
      ? `${getPageContext(pathname)}。用户正在指向页面中的【${pinLabel}】`
      : getPageContext(pathname)

    const userMsg: Message = { role: "user", content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput("")
    setStreaming(true)
    setStreamContent("")

    const abort = new AbortController()
    abortRef.current = abort
    let accumulated = ""

    try {
      const res = await fetch("/ma/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          pageContext: pageCtx,
          screenshot: screenshot ?? undefined,
        }),
        signal: abort.signal,
      })

      if (!res.ok) throw new Error(`请求失败 (${res.status})`)
      if (!res.body) throw new Error("无响应体")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (abort.signal.aborted) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") continue
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content
            if (delta) {
              accumulated += delta
              setStreamContent(accumulated)
            }
          } catch {
            // skip malformed SSE line
          }
        }
      }

      setMessages([...nextMessages, { role: "assistant", content: accumulated }])
      setStreamContent("")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User stopped — commit whatever was accumulated so far
        if (accumulated) {
          setMessages([...nextMessages, { role: "assistant", content: accumulated + " \u25a0" }])
        }
        setStreamContent("")
        setStreaming(false)
        return
      }
      const msg = err instanceof Error ? err.message : "未知错误"
      setMessages([...nextMessages, { role: "assistant", content: `⚠️ ${msg}` }])
      setStreamContent("")
    } finally {
      setStreaming(false)
    }
  }

  if (!visible || pos === null) return null

  // ── Ball mode ─────────────────────────────────────────────────────────────
  if (mode === "ball") {
    return (
      <>
        <style>{`
          @keyframes ai-ball-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.55), 0 0 32px 8px rgba(99,102,241,0.30), inset 0 -6px 16px rgba(0,0,0,0.35), inset 0 4px 10px rgba(255,255,255,0.25); }
            50%       { box-shadow: 0 0 0 10px rgba(99,102,241,0), 0 0 48px 14px rgba(139,92,246,0.40), inset 0 -6px 16px rgba(0,0,0,0.35), inset 0 4px 10px rgba(255,255,255,0.25); }
          }
          @keyframes ai-ball-orbit {
            from { transform: rotate(0deg) translateX(12px) rotate(0deg); opacity: 0.7; }
            to   { transform: rotate(360deg) translateX(12px) rotate(-360deg); opacity: 0.7; }
          }
          .ai-ball-root:hover .ai-ball-inner { transform: scale(1.08); }
          .ai-ball-root:active { cursor: grabbing !important; }
        `}</style>
        <div
          className="ai-ball-root fixed z-[9999] select-none cursor-grab"
          style={{ left: pos.x - 28, top: pos.y - 28, width: 56, height: 56 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="AI 助手（点击展开，拖拽移位）"
        >
          {/* outer glow ring */}
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "radial-gradient(circle at 38% 35%, #818cf8 0%, #6366f1 40%, #4f46e5 70%, #3730a3 100%)",
            animation: "ai-ball-pulse 2.8s ease-in-out infinite",
          }} />
          {/* shiny highlight */}
          <div style={{
            position: "absolute", top: 7, left: 12, width: 16, height: 9, borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 100%)",
            pointerEvents: "none",
          }} />
          {/* inner content */}
          <div
            className="ai-ball-inner"
            style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 0.18s ease",
            }}
          >
            <Bot style={{ width: 22, height: 22, color: "#fff", filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))", pointerEvents: "none" }} />
          </div>
          {/* orbiting dot */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            width: 7, height: 7, marginTop: -3.5, marginLeft: -3.5,
            borderRadius: "50%",
            background: "radial-gradient(circle, #c7d2fe, #818cf8)",
            boxShadow: "0 0 6px 2px rgba(165,180,252,0.8)",
            animation: "ai-ball-orbit 3.2s linear infinite",
            pointerEvents: "none",
          }} />
        </div>
      </>
    )
  }

  // ── Chat mode ─────────────────────────────────────────────────────────────
  const cp = chatPos ?? { x: window.innerWidth - chatSize.w - 8, y: window.innerHeight - chatSize.h - 8 }
  return (
    <>
      {/* ── Pinning overlay: full-screen crosshair layer ── */}
      {pinningMode && (
        <>
          <div
            data-pinning-overlay=""
            style={{ position: "fixed", inset: 0, zIndex: 10000, cursor: "crosshair" }}
            onPointerMove={(e) => setPinCursorPos({ x: e.clientX, y: e.clientY })}
            onClick={(e) => { e.stopPropagation(); commitPin(e.clientX, e.clientY) }}
            onKeyDown={(e) => { if (e.key === "Escape") setPinningMode(false) }}
          />
          {pinLineStart && pinCursorPos && (
            <svg
              style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 10001 }}
            >
              <defs>
                <marker id="ai-pin-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L9,3 z" fill="#6366f1" />
                </marker>
              </defs>
              <line
                x1={pinLineStart.x} y1={pinLineStart.y}
                x2={pinCursorPos.x} y2={pinCursorPos.y}
                stroke="#6366f1" strokeWidth="2" strokeDasharray="6 3"
                markerEnd="url(#ai-pin-arrow)"
              />
              <circle cx={pinLineStart.x} cy={pinLineStart.y} r="5" fill="#6366f1" />
              <circle cx={pinCursorPos.x} cy={pinCursorPos.y} r="5" fill="none" stroke="#6366f1" strokeWidth="2" />
              <circle cx={pinCursorPos.x} cy={pinCursorPos.y} r="12" fill="none" stroke="rgba(99,102,241,0.35)" strokeWidth="1" />
            </svg>
          )}
        </>
      )}

      <div
        ref={chatBoxRef}
        data-chat-box=""
        className="fixed z-[9999] flex flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
        style={{ width: chatSize.w, height: chatSize.h, left: cp.x, top: cp.y, pointerEvents: pinningMode ? "none" : undefined }}
      >
      {/* Header — drag handle only on left portion, buttons on right stay clickable */}
      <div
        className="flex shrink-0 select-none items-center justify-between bg-primary px-4 py-3"
      >
        <div
          className="flex flex-1 cursor-grab items-center gap-2 text-primary-foreground active:cursor-grabbing"
          onPointerDown={onChatHeaderPointerDown}
          onPointerMove={onChatHeaderPointerMove}
          onPointerUp={onChatHeaderPointerUp}
        >
          <Bot className="h-4 w-4 pointer-events-none" />
          <span className="text-sm font-semibold pointer-events-none">AI 助手</span>
        </div>
        <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className="rounded p-1.5 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={() => setMode("ball")}
            title="最小化"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1.5 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesBoxRef}
        className="flex-1 overflow-y-auto space-y-3 px-3 py-3"
        onScroll={() => {
          const el = messagesBoxRef.current
          if (!el) return
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          userScrolledUpRef.current = !atBottom
        }}
      >
        {messages.length === 0 && !streaming && (
          <p className="mt-10 text-center text-xs text-muted-foreground px-4">
            你好！有关于当前页面数据或市场分析的问题，随时问我。
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}

        {/* Streaming bubble */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
              {streamContent ? (
                <>
                  {streamContent}
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-foreground align-middle" />
                </>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t p-3">
        {/* Screenshot preview */}
        {pendingScreenshot && (
          <div className="relative mb-2 inline-block">
            <img src={pendingScreenshot} alt="截图" className="h-16 rounded-md border object-cover shadow-sm" />
            <button
              onClick={() => setPendingScreenshot(null)}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
            >
              <X className="h-3 w-3" />
            </button>
            <span className="absolute bottom-0.5 left-1 text-[9px] font-medium text-white drop-shadow">当前页面截图</span>
          </div>
        )}

        {/* Pinned target chip */}
        {pinnedTarget && (
          <div className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs dark:border-indigo-700 dark:bg-indigo-950">
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
            <span className="flex-1 truncate font-medium text-indigo-700 dark:text-indigo-300">{pinnedTarget.label}</span>
            {pinnedTarget.screenshot && (
              <img src={pinnedTarget.screenshot} alt="指向区域" className="h-8 w-12 shrink-0 rounded object-cover" />
            )}
            <button onClick={() => setPinnedTarget(null)} className="shrink-0 text-indigo-400 hover:text-indigo-600">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="输入问题… Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = "auto"
              e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            disabled={streaming}
            className="flex-1 resize-none overflow-y-auto rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            style={{ minHeight: 36, maxHeight: 100 }}
          />
          <Button
            ref={pinBtnRef}
            size="icon"
            variant={pinningMode ? "default" : "outline"}
            className="h-9 w-9 shrink-0 rounded-xl"
            onClick={startPinning}
            disabled={streaming}
            title="指向图表—点击后在页面上点击任意图表/区域"
          >
            <Crosshair className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0 rounded-xl"
            onClick={captureScreen}
            disabled={streaming || capturingScreen}
            title="截取当前页面图表发给 AI"
          >
            {capturingScreen
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Camera className="h-4 w-4" />}
          </Button>
          {streaming ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0 rounded-xl"
              onClick={stopGeneration}
              title="停止生成"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl"
              onClick={sendMessage}
              disabled={!input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Resize handles */}
      {/* bottom-right corner */}
      <div className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize" onPointerDown={(e) => onResizePointerDown(e, "se")} />
      {/* right edge */}
      <div className="absolute right-0 top-12 bottom-4 w-1.5 cursor-e-resize" onPointerDown={(e) => onResizePointerDown(e, "e")} />
      {/* bottom edge */}
      <div className="absolute bottom-0 left-4 right-4 h-1.5 cursor-s-resize" onPointerDown={(e) => onResizePointerDown(e, "s")} />
    </div>
    </>
  )
}
