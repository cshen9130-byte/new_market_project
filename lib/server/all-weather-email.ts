import fs from "fs"
import path from "path"
import nodemailer from "nodemailer"
import { displayListedName, SLEEVE_LABELS } from "@/lib/all-weather/universe"
import { getOverview, type OverviewPayload, type SleeveView } from "@/lib/server/all-weather-book"

const DATA_DIR = path.join(process.cwd(), "data", "all-weather")
const CONFIG_FILE = path.join(DATA_DIR, "email.json")

export type AllWeatherEmailConfig = {
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
}

const DEFAULT_CONFIG: AllWeatherEmailConfig = {
  sender: null,
  receivers: [],
  scheduleTime: "09:00",
  enabled: false,
  lastSentDate: null,
  lastSentAt: null,
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readEmailConfig(): AllWeatherEmailConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeEmailConfig(config: AllWeatherEmailConfig): AllWeatherEmailConfig {
  ensureDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8")
  return config
}

export function publicEmailConfig(config: AllWeatherEmailConfig) {
  return {
    ...config,
    sender: config.sender
      ? { name: config.sender.name, host: config.sender.host, port: config.sender.port, user: config.sender.user, secure: config.sender.secure }
      : null,
    hasPassword: Boolean(config.sender?.pass),
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
  if (n > 0) return "#15803d"
  if (n < 0) return "#b91c1c"
  return "#334155"
}

function productTable(products: SleeveView["products"]): string {
  const rows = [...products]
    .sort((a, b) => b.margin - a.margin)
    .map(
      (p) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${displayListedName(p.label, p.contract)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${p.lots}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${p.price.toLocaleString("zh-CN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${yuan(p.margin)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${
          p.lots > 0 ? pct(p.riskShare) : "0%（不足一手）"
        }</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(p.dailyPnl)};">${yuan(p.dailyPnl)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(p.cumPnl)};">${yuan(p.cumPnl)}</td>
      </tr>`,
    )
    .join("")
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#f8fafc;color:#475569;">
        <th style="text-align:left;padding:6px 8px;">品种</th>
        <th style="text-align:right;padding:6px 8px;">手数</th>
        <th style="text-align:right;padding:6px 8px;">价格</th>
        <th style="text-align:right;padding:6px 8px;">保证金</th>
        <th style="text-align:right;padding:6px 8px;">风险贡献</th>
        <th style="text-align:right;padding:6px 8px;">当日盈亏</th>
        <th style="text-align:right;padding:6px 8px;">累计盈亏</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
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
  const { book, sleeves, totals, strategy } = overview
  const sleeveRows = sleeves
    .map(
      (s) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${s.label}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${s.lots}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${yuan(s.margin)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(s.riskShare)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(s.dailyPnl)};">${yuan(s.dailyPnl)}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;color:${pnlColor(s.cumPnl)};">${yuan(s.cumPnl)}</td>
      </tr>`,
    )
    .join("")

  const sleeveBlocks = sleeves
    .map(
      (s) => `<h3 style="margin:24px 0 8px;font-size:15px;color:#0f172a;">${s.label}袖套</h3>${productTable(s.products)}`,
    )
    .join("")

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;">
  <div style="max-width:880px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
    <h1 style="margin:0 0 4px;font-size:20px;">${strategy.name}</h1>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px;">模拟实盘跟踪 · 初始资金 ${yuan(book.initialCapital)} 元 · ${book.asOf}</p>
    <table style="width:100%;margin-bottom:16px;font-size:14px;">
      <tr>
        <td>组合净值<br><b>${yuan(book.equity)}</b></td>
        <td>当日盈亏<br><b style="color:${pnlColor(book.dailyPnl)};">${yuan(book.dailyPnl)}</b></td>
        <td>累计盈亏<br><b style="color:${pnlColor(book.cumPnl)};">${yuan(book.cumPnl)}</b></td>
        <td>保证金 / 使用率<br><b>${yuan(totals.margin)} · ${pct(totals.marginUtil)}</b></td>
      </tr>
    </table>
    ${rebalanceTable(overview)}
    <h3 style="margin:16px 0 8px;font-size:15px;">袖套汇总</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f8fafc;color:#475569;">
          <th style="text-align:left;padding:8px;">袖套</th>
          <th style="text-align:right;padding:8px;">手数</th>
          <th style="text-align:right;padding:8px;">保证金</th>
          <th style="text-align:right;padding:8px;">风险贡献</th>
          <th style="text-align:right;padding:8px;">当日盈亏</th>
          <th style="text-align:right;padding:8px;">累计盈亏</th>
        </tr>
      </thead>
      <tbody>${sleeveRows}</tbody>
    </table>
    ${sleeveBlocks}
    <p style="margin-top:16px;color:#475569;font-size:13px;">明细 CSV 见附件：持仓/交易明细、袖套汇总、每日盈亏${
      overview.isRebalanceDay ? "、调仓变动" : ""
    }。</p>
    ${
      extraNames.length
        ? `<p style="margin-top:8px;color:#475569;font-size:13px;">本次一次性附件：${extraNames.map((n) => escapeHtml(n)).join("、")}。</p>`
        : ""
    }
    <p style="margin-top:8px;color:#94a3b8;font-size:12px;">
      手数按最近一次月末再平衡目标权重（${strategy.lastRebalance}）缩放至 ${yuan(book.initialCapital)} 元。
      价格来源：${book.priceSource === "sina" ? "新浪行情" : "回测快照"}。债券仅 T，权益为 IF/IC/IM。合约按设置使用${
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
  const { book, sleeves } = overview
  const date = book.asOf
  const products = [...book.positions].sort((a, b) => a.sleeve.localeCompare(b.sleeve) || b.margin - a.margin)

  const tradeRows = products.map((p) => [
    date,
    SLEEVE_LABELS[p.sleeve],
    p.label,
    p.contract || p.asset,
    p.lots > 0 ? "开仓" : "未开仓",
    p.lots,
    p.price,
    p.multiplier,
    Math.round(p.notional * 100) / 100,
    Math.round(p.margin * 100) / 100,
    p.marginRate,
    p.targetWeight,
    p.targetRiskShare ?? p.riskShare,
    p.riskShare,
    Math.round(p.dailyPnl * 100) / 100,
    Math.round(p.cumPnl * 100) / 100,
  ])

  const sleeveRows = sleeves.map((s) => [
    date,
    s.label,
    s.lots,
    Math.round(s.notional * 100) / 100,
    Math.round(s.margin * 100) / 100,
    s.riskShare,
    Math.round(s.dailyPnl * 100) / 100,
    Math.round(s.cumPnl * 100) / 100,
  ])

  const dailyRows = book.daily.map((r) => [
    r.date,
    Math.round(r.equity * 100) / 100,
    Math.round(r.dailyPnl * 100) / 100,
    Math.round((r.equity - book.initialCapital) * 100) / 100,
    Math.round((r.sleevePnl.Equity ?? 0) * 100) / 100,
    Math.round((r.sleevePnl.Bonds ?? 0) * 100) / 100,
    Math.round((r.sleevePnl.Gold ?? 0) * 100) / 100,
    Math.round((r.sleevePnl.Commodity ?? 0) * 100) / 100,
  ])

  const type = "text/csv; charset=utf-8"
  const files = [
    {
      filename: `allweather_trade_details_${date}.csv`,
      contentType: type,
      content: toCsv(
        [
          "日期",
          "袖套",
          "品种",
          "合约",
          "方向",
          "手数",
          "价格",
          "乘数",
          "名义价值",
          "保证金",
          "保证金率",
          "目标权重",
          "目标风险贡献",
          "实际风险贡献",
          "当日盈亏",
          "累计盈亏",
        ],
        tradeRows,
      ),
    },
    {
      filename: `allweather_sleeves_${date}.csv`,
      contentType: type,
      content: toCsv(
        ["日期", "袖套", "手数", "名义价值", "保证金", "风险贡献", "当日盈亏", "累计盈亏"],
        sleeveRows,
      ),
    },
    {
      filename: `allweather_daily_pnl_${date}.csv`,
      contentType: type,
      content: toCsv(
        ["日期", "净值", "当日盈亏", "累计盈亏", "权益盈亏", "债券盈亏", "黄金盈亏", "商品盈亏"],
        dailyRows,
      ),
    },
  ]
  const rebalance = overview.rebalanceTrades ?? []
  if (overview.isRebalanceDay && rebalance.length) {
    files.push({
      filename: `allweather_rebalance_${date}.csv`,
      contentType: type,
      content: toCsv(
        ["日期", "袖套", "品种", "调前合约", "调后合约", "方向", "调前手数", "调后手数", "变动手数", "价格", "成交名义"],
        rebalance.map((t) => [
          t.date,
          SLEEVE_LABELS[t.sleeve],
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

function resolveSmtp(config: AllWeatherEmailConfig) {
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
}

export type ExtraEmailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export async function sendAllWeatherEmail(opts?: {
  overview?: OverviewPayload
  extraAttachments?: ExtraEmailAttachment[]
}): Promise<{ messageId: string }> {
  const config = readEmailConfig()
  if (config.receivers.length === 0) throw new Error("请先填写收件邮箱。")
  const smtp = resolveSmtp(config)
  const overview = opts?.overview ?? (await getOverview(true))
  const subject = `${overview.isRebalanceDay ? "【调仓】" : ""}全天候策略跟踪 ${overview.book.asOf}  净值 ${overview.book.equity.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
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
  writeEmailConfig({
    ...config,
    lastSentDate: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    lastSentAt: now.toISOString(),
  })
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

export async function runDueAllWeatherEmails(): Promise<void> {
  const config = readEmailConfig()
  if (!config.enabled) return
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  if (config.scheduleTime !== hhmm) return
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  if (config.lastSentDate === today) return
  try {
    await sendAllWeatherEmail()
  } catch (e) {
    console.error("[all-weather-email] scheduled send failed:", e)
  }
}
