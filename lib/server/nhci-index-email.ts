import fs from "fs"
import path from "path"
import nodemailer from "nodemailer"
import { displayListedName } from "@/lib/all-weather/universe"
import {
  readEmailConfig as readAllWeatherEmailConfig,
  writeEmailConfig as writeAllWeatherEmailConfig,
} from "@/lib/server/all-weather-email"
import { getNhciOverview, type OverviewPayload } from "@/lib/server/nhci-index-book"
import { isChinaWeekendOrPublicHoliday, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

const DATA_DIR = path.join(process.cwd(), "data", "nhci-index")
const CONFIG_FILE = path.join(DATA_DIR, "email.json")
const SEND_LOCK_FILE = path.join(DATA_DIR, "email-send.lock")

export type NhciIndexEmailConfig = {
  sender: {
    name: string
    host: string
    port: number
    user: string
    pass: string
    secure: boolean
  } | null
  receivers: string[]
  scheduleTime: string
  enabled: boolean
  lastSentDate: string | null
  lastSentAt: string | null
  lastScheduledDate: string | null
  lastError: string | null
  lastErrorAt: string | null
}

type NhciLocalEmailState = {
  enabled: boolean
  lastSentDate: string | null
  lastSentAt: string | null
  lastScheduledDate: string | null
  lastError: string | null
  lastErrorAt: string | null
}

const DEFAULT_LOCAL: NhciLocalEmailState = {
  enabled: false,
  lastSentDate: null,
  lastSentAt: null,
  lastScheduledDate: null,
  lastError: null,
  lastErrorAt: null,
}

const DEFAULT_CONFIG: NhciIndexEmailConfig = {
  sender: null,
  receivers: [],
  scheduleTime: "09:00",
  ...DEFAULT_LOCAL,
}

function shanghaiParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  )
  return {
    dateKey: `${parts.year}${parts.month}${parts.day}`,
    hhmm: `${String(parts.hour ?? "").padStart(2, "0")}:${String(parts.minute ?? "").padStart(2, "0")}`,
  }
}

export function isScheduledSendDue(config: NhciIndexEmailConfig = readEmailConfig(), now = new Date()): boolean {
  if (!config.enabled) return false
  if (!/^\d{2}:\d{2}$/.test(config.scheduleTime || "")) return false
  if (isChinaWeekendOrPublicHoliday(shanghaiTodayIsoDate(now))) return false
  const { dateKey, hhmm } = shanghaiParts(now)
  if (config.lastScheduledDate === dateKey) return false
  return hhmm >= config.scheduleTime
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(SEND_LOCK_FILE, "utf-8").trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function tryAcquireSendLock(): boolean {
  ensureDir()
  const writeLock = (): boolean => {
    try {
      const fd = fs.openSync(SEND_LOCK_FILE, "wx")
      fs.writeFileSync(fd, String(process.pid), "utf-8")
      fs.closeSync(fd)
      return true
    } catch {
      return false
    }
  }
  if (writeLock()) return true
  const pid = readLockPid()
  if (pid != null && pid !== process.pid && pidIsAlive(pid)) return false
  try {
    fs.unlinkSync(SEND_LOCK_FILE)
  } catch {
    // ignore
  }
  return writeLock()
}

function releaseSendLock(): void {
  try {
    const pid = readLockPid()
    if (pid == null || pid === process.pid) fs.unlinkSync(SEND_LOCK_FILE)
  } catch {
    // ignore
  }
}

function readLocalState(): NhciLocalEmailState {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_LOCAL }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<NhciLocalEmailState>
    return { ...DEFAULT_LOCAL, ...raw }
  } catch {
    return { ...DEFAULT_LOCAL }
  }
}

function writeLocalState(state: NhciLocalEmailState): NhciLocalEmailState {
  ensureDir()
  const next = { ...DEFAULT_LOCAL, ...state }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8")
  return next
}

/** Mailbox (SMTP + recipients + send time) is shared with 全天候; auto-send switch is local. */
export function readEmailConfig(): NhciIndexEmailConfig {
  const aw = readAllWeatherEmailConfig()
  const local = readLocalState()
  return {
    sender: aw.sender,
    receivers: aw.receivers ?? [],
    scheduleTime: aw.scheduleTime || DEFAULT_CONFIG.scheduleTime,
    ...local,
  }
}

export function writeEmailConfig(config: NhciIndexEmailConfig, opts?: { mailbox?: boolean }): NhciIndexEmailConfig {
  writeLocalState({
    enabled: config.enabled,
    lastSentDate: config.lastSentDate,
    lastSentAt: config.lastSentAt,
    lastScheduledDate: config.lastScheduledDate,
    lastError: config.lastError,
    lastErrorAt: config.lastErrorAt,
  })
  if (opts?.mailbox !== false) {
    const aw = readAllWeatherEmailConfig()
    const nextPass = config.sender?.pass?.trim() || aw.sender?.pass || ""
    writeAllWeatherEmailConfig({
      ...aw,
      sender: config.sender
        ? {
            name: String(config.sender.name || "").trim() || aw.sender?.name || "全天候发件箱",
            host: String(config.sender.host || "").trim(),
            port: Number(config.sender.port || 465),
            user: String(config.sender.user || "").trim(),
            pass: nextPass,
            secure: Number(config.sender.port || 465) === 465 ? true : config.sender.secure !== false,
          }
        : aw.sender,
      receivers: config.receivers,
      scheduleTime: config.scheduleTime || aw.scheduleTime,
    })
  }
  return readEmailConfig()
}

export function publicEmailConfig(config: NhciIndexEmailConfig) {
  return {
    sender: config.sender
      ? { name: config.sender.name, host: config.sender.host, port: config.sender.port, user: config.sender.user, secure: config.sender.secure }
      : null,
    receivers: config.receivers,
    scheduleTime: config.scheduleTime,
    hasPassword: Boolean(config.sender?.pass),
    enabled: config.enabled,
    lastSentDate: config.lastSentDate,
    lastSentAt: config.lastSentAt,
    lastScheduledDate: config.lastScheduledDate,
    lastError: config.lastError,
    lastErrorAt: config.lastErrorAt,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function yuan(n: number): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}${Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

function pnlColor(n: number): string {
  if (n > 0) return "#b91c1c"
  if (n < 0) return "#15803d"
  return "#334155"
}

function productTable(overview: OverviewPayload): string {
  const products = [...overview.book.positions].sort((a, b) => b.riskShare - a.riskShare || b.targetWeight - a.targetWeight)
  const rows = products
    .map(
      (p) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${displayListedName(p.label, p.contract)}${
          p.lots === 0 ? `<div style="color:#94a3b8;font-size:11px;">不足一手</div>` : ""
        }</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${p.lots}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${p.price.toLocaleString("zh-CN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${yuan(p.margin)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(p.targetWeight)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(p.weightShare ?? 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(p.riskContrib ?? 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(p.riskShare)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(p.dailyPnl)};">${yuan(p.dailyPnl)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(p.cumPnl)};">${yuan(p.cumPnl)}</td>
      </tr>`,
    )
    .join("")
  const totalWeight = products.reduce((n, p) => n + p.targetWeight, 0)
  const totalWeightShare = products.reduce((n, p) => n + (p.weightShare ?? 0), 0)
  const totalRiskContrib = products.reduce((n, p) => n + (p.riskContrib ?? 0), 0)
  const totalRiskShare = products.reduce((n, p) => n + p.riskShare, 0)
  const totalMargin = products.reduce((n, p) => n + p.margin, 0)
  const totalLots = products.reduce((n, p) => n + p.lots, 0)
  const totalDaily = products.reduce((n, p) => n + p.dailyPnl, 0)
  const totalCum = products.reduce((n, p) => n + p.cumPnl, 0)
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#f8fafc;color:#475569;">
        <th style="text-align:left;padding:6px 8px;">品种</th>
        <th style="text-align:right;padding:6px 8px;">手数</th>
        <th style="text-align:right;padding:6px 8px;">价格</th>
        <th style="text-align:right;padding:6px 8px;">保证金</th>
        <th style="text-align:right;padding:6px 8px;">名义权重</th>
        <th style="text-align:right;padding:6px 8px;">权重占比</th>
        <th style="text-align:right;padding:6px 8px;">风险贡献</th>
        <th style="text-align:right;padding:6px 8px;">风险贡献占比</th>
        <th style="text-align:right;padding:6px 8px;">当日盈亏</th>
        <th style="text-align:right;padding:6px 8px;">累计盈亏</th>
      </tr>
    </thead>
    <tbody>${rows}
      <tr style="font-weight:600;">
        <td style="padding:6px 8px;">合计</td>
        <td style="padding:6px 8px;text-align:right;">${totalLots}</td>
        <td></td>
        <td style="padding:6px 8px;text-align:right;">${yuan(totalMargin)}</td>
        <td style="padding:6px 8px;text-align:right;">${pct(totalWeight)}</td>
        <td style="padding:6px 8px;text-align:right;">${pct(totalWeightShare)}</td>
        <td style="padding:6px 8px;text-align:right;">${pct(totalRiskContrib)}</td>
        <td style="padding:6px 8px;text-align:right;">${pct(totalRiskShare)}</td>
        <td style="padding:6px 8px;text-align:right;color:${pnlColor(totalDaily)};">${yuan(totalDaily)}</td>
        <td style="padding:6px 8px;text-align:right;color:${pnlColor(totalCum)};">${yuan(totalCum)}</td>
      </tr>
    </tbody>
  </table>`
}

function rebalanceTable(overview: OverviewPayload): string {
  const trades = overview.rebalanceTrades ?? []
  if (!overview.isRebalanceDay || trades.length === 0) return ""
  const rows = trades
    .map(
      (t) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${displayListedName(t.label, t.contract)}${
          t.prevContract && t.prevContract !== t.contract
            ? `<div style="color:#64748b;font-size:11px;">从 ${t.prevContract} 移仓</div>`
            : ""
        }</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${t.side}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${t.prevLots}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;"><b>${t.newLots}</b></td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${
          t.delta > 0 ? "#15803d" : t.delta < 0 ? "#b91c1c" : "#334155"
        };">${t.delta > 0 ? `+${t.delta}` : t.delta}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${yuan(t.tradeNotional)}</td>
      </tr>`,
    )
    .join("")
  return `<h3 style="margin:16px 0 8px;font-size:15px;color:#92400e;">调仓日持仓变动</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <thead>
        <tr style="background:#fffbeb;color:#92400e;">
          <th style="text-align:left;padding:6px 8px;">品种 / 合约</th>
          <th style="text-align:left;padding:6px 8px;">方向</th>
          <th style="text-align:right;padding:6px 8px;">调前</th>
          <th style="text-align:right;padding:6px 8px;">调后</th>
          <th style="text-align:right;padding:6px 8px;">变动</th>
          <th style="text-align:right;padding:6px 8px;">成交名义</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

export function renderDailyEmailHtml(overview: OverviewPayload, extraNames: string[] = []): string {
  const { book, totals, strategy } = overview
  const summary = strategy.summary

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;">
  <div style="max-width:880px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
    <h1 style="margin:0 0 4px;font-size:20px;">NHCI 指数跟踪</h1>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px;">${strategy.nAssetsUniverse ?? 22} 个南华成分品种 · 日度再平衡 · 模拟实盘 ${yuan(book.initialCapital)} 元 · ${book.asOf}</p>
    <table style="width:100%;margin-bottom:16px;font-size:14px;">
      <tr>
        <td>组合净值<br><b>${yuan(book.equity)}</b></td>
        <td>当日盈亏<br><b style="color:${pnlColor(book.dailyPnl)};">${yuan(book.dailyPnl)}</b></td>
        <td>累计盈亏<br><b style="color:${pnlColor(book.cumPnl)};">${yuan(book.cumPnl)}</b></td>
        <td>保证金 / 使用率<br><b>${yuan(totals.margin)} · ${pct(totals.marginUtil)}</b></td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#475569;font-size:13px;line-height:1.6;">
      回测 CAGR ${pct(summary.cagr)} · 对 NHCI 样本外相关 ${summary.expostCorr?.toFixed(2) ?? "—"} · 跟踪误差 ${summary.expostTe != null ? pct(summary.expostTe) : "—"} · 波动目标 ${pct(strategy.volTarget)}
    </p>
    ${rebalanceTable(overview)}
    <h3 style="margin:16px 0 8px;font-size:15px;">品种持仓</h3>
    ${productTable(overview)}
    <p style="margin-top:16px;color:#475569;font-size:13px;">明细 CSV 见附件：持仓明细、每日盈亏${
      overview.isRebalanceDay ? "、调仓变动" : ""
    }。</p>
    ${
      extraNames.length
        ? `<p style="margin-top:8px;color:#475569;font-size:13px;">本次一次性附件：${extraNames.map((n) => escapeHtml(n)).join("、")}。</p>`
        : ""
    }
    <p style="margin-top:8px;color:#94a3b8;font-size:12px;">
      手数按最近一次日度再平衡目标权重（${strategy.lastRebalance}）缩放；不足一手不开仓。
      价格来源：${book.priceSource === "sina" ? "新浪行情" : "回测快照"}。合约按设置使用${
        overview.settings?.contractTenor === "following" ? "下季/次主力" : "当月/主力"
      }月份。
    </p>
  </div>
</body></html>`
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "")
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))]
  return `\uFEFF${lines.join("\r\n")}\r\n`
}

export function buildTradeDetailAttachments(overview: OverviewPayload): Array<{
  filename: string
  content: string
  contentType: string
}> {
  const { book } = overview
  const date = book.asOf
  const products = [...book.positions].sort((a, b) => b.riskShare - a.riskShare || b.targetWeight - a.targetWeight)

  const positionRows = products.map((p) => [
    date,
    p.label,
    p.contract || p.asset,
    p.lots,
    p.price,
    p.multiplier,
    Math.round(p.notional * 100) / 100,
    Math.round(p.margin * 100) / 100,
    p.marginRate,
    p.targetWeight,
    p.weightShare ?? 0,
    p.riskContrib ?? 0,
    p.riskShare,
    Math.round(p.dailyPnl * 100) / 100,
    Math.round(p.cumPnl * 100) / 100,
  ])

  const dailyRows = book.daily.map((r) => [
    r.date,
    Math.round(r.equity * 100) / 100,
    Math.round(r.dailyPnl * 100) / 100,
    Math.round((r.equity - book.initialCapital) * 100) / 100,
  ])

  const type = "text/csv; charset=utf-8"
  const files = [
    {
      filename: `nhci_index_positions_${date}.csv`,
      contentType: type,
      content: toCsv(
        [
          "日期",
          "品种",
          "合约",
          "手数",
          "价格",
          "乘数",
          "名义价值",
          "保证金",
          "保证金率",
          "名义权重",
          "权重占比",
          "风险贡献",
          "风险贡献占比",
          "当日盈亏",
          "累计盈亏",
        ],
        positionRows,
      ),
    },
    {
      filename: `nhci_index_daily_pnl_${date}.csv`,
      contentType: type,
      content: toCsv(["日期", "净值", "当日盈亏", "累计盈亏"], dailyRows),
    },
  ]

  const rebalance = overview.rebalanceTrades ?? []
  if (overview.isRebalanceDay && rebalance.length) {
    files.push({
      filename: `nhci_index_rebalance_${date}.csv`,
      contentType: type,
      content: toCsv(
        ["日期", "品种", "调前合约", "调后合约", "方向", "调前手数", "调后手数", "变动手数", "价格", "成交名义"],
        rebalance.map((t) => [
          t.date,
          t.label,
          t.prevContract,
          t.contract,
          t.side,
          t.prevLots,
          t.newLots,
          t.delta,
          t.price,
          Math.round(t.tradeNotional * 100) / 100,
        ]),
      ),
    })
  }
  return files
}

function resolveSmtp(config: NhciIndexEmailConfig) {
  const raw = (() => {
    if (config.sender?.host && config.sender.user && config.sender.pass) {
      return config.sender
    }
    const host = process.env.SMTP_HOST ?? ""
    const user = process.env.SMTP_USER ?? ""
    const pass = process.env.SMTP_PASS ?? ""
    if (!host || !user || !pass) {
      throw new Error("请先配置发件邮箱，或在服务器环境变量中设置 SMTP_HOST / SMTP_USER / SMTP_PASS。")
    }
    return {
      name: "env",
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      user,
      pass,
      secure: process.env.SMTP_SECURE !== "false",
    }
  })()
  const port = Number(raw.port || 465)
  return {
    ...raw,
    port,
    secure: port === 465 ? true : Boolean(raw.secure),
  }
}

export type ExtraEmailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export async function sendNhciIndexEmail(opts?: {
  overview?: OverviewPayload
  extraAttachments?: ExtraEmailAttachment[]
  source?: "manual" | "scheduled"
}): Promise<{ messageId: string }> {
  const config = readEmailConfig()
  if (config.receivers.length === 0) throw new Error("请先填写收件邮箱。")
  const smtp = resolveSmtp(config)
  const overview = opts?.overview ?? (await getNhciOverview(true))
  const subject = `${overview.isRebalanceDay ? "【调仓】" : ""}NHCI指数跟踪 ${overview.book.asOf}  净值 ${overview.book.equity.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  const extras = (opts?.extraAttachments ?? []).map((a) => ({
    filename: a.filename,
    content: a.content,
    contentType: a.contentType || "application/octet-stream",
  }))
  const info = await transporter.sendMail({
    from: smtp.user,
    to: config.receivers.join(", "),
    subject,
    html: renderDailyEmailHtml(overview, extras.map((a) => a.filename)),
    attachments: [...buildTradeDetailAttachments(overview), ...extras],
  })
  const now = new Date()
  const dateKey = shanghaiParts(now).dateKey
  const latest = readEmailConfig()
  writeEmailConfig(
    {
      ...latest,
      lastSentDate: dateKey,
      lastSentAt: now.toISOString(),
      lastScheduledDate: opts?.source === "scheduled" ? dateKey : latest.lastScheduledDate,
      lastError: null,
      lastErrorAt: null,
    },
    { mailbox: false },
  )
  return { messageId: String(info.messageId ?? "") }
}

export async function testSenderConnection(config = readEmailConfig()): Promise<void> {
  const smtp = resolveSmtp(config)
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  await transporter.verify()
}

export async function runDueNhciIndexEmails(): Promise<{ sent: boolean; error: string | null }> {
  if (!tryAcquireSendLock()) return { sent: false, error: null }
  try {
    const now = new Date()
    const config = readEmailConfig()
    if (!isScheduledSendDue(config, now)) return { sent: false, error: null }
    const dateKey = shanghaiParts(now).dateKey
    writeEmailConfig({ ...config, lastScheduledDate: dateKey }, { mailbox: false })
    try {
      await sendNhciIndexEmail({ source: "scheduled" })
      return { sent: true, error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error("[nhci-index-email] scheduled send failed:", e)
      const latest = readEmailConfig()
      writeEmailConfig(
        {
          ...latest,
          lastScheduledDate: latest.lastScheduledDate === dateKey ? config.lastScheduledDate : latest.lastScheduledDate,
          lastError: message,
          lastErrorAt: new Date().toISOString(),
        },
        { mailbox: false },
      )
      return { sent: false, error: message }
    }
  } finally {
    releaseSendLock()
  }
}
