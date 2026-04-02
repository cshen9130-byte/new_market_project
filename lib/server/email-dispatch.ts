import fs from "fs"
import path from "path"
import nodemailer from "nodemailer"
import { randomUUID } from "crypto"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SenderAccount = {
  id: string
  name: string        // display label, e.g. "市场监控 (QQ企业邮)"
  host: string
  port: number
  user: string
  pass: string        // stored as plain text in local JSON (server-side only)
  secure: boolean
  createdAt: string
}

export type DispatchSetup = {
  id: string
  name: string
  senderId: string | null  // null → fall back to env SMTP_*
  traderCode: string
  to: string[]
  subject: string
  content: string
  scheduleTime: string     // HH:MM (24h)
  enabled: boolean
  lastSentDate: string | null  // YYYYMMDD
  lastSentAt: string | null    // ISO timestamp
  createdAt: string
}

// ─── File paths ───────────────────────────────────────────────────────────────

const SETUPS_FILE  = path.join(process.cwd(), "data", "email_dispatch_setups.json")
const SENDERS_FILE = path.join(process.cwd(), "data", "email_dispatch_senders.json")

const MOM_BASE_DIR =
  process.env.MOM_DATA_DIR ?? path.join(process.cwd(), "..", "mom_data", "03.投顾逐日")

// ─── Sender account persistence ───────────────────────────────────────────────

export function readSenders(): SenderAccount[] {
  if (!fs.existsSync(SENDERS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(SENDERS_FILE, "utf-8")) as SenderAccount[]
  } catch {
    return []
  }
}

function writeSenders(senders: SenderAccount[]): void {
  fs.writeFileSync(SENDERS_FILE, JSON.stringify(senders, null, 2), "utf-8")
}

export function createSender(
  data: Omit<SenderAccount, "id" | "createdAt">,
): SenderAccount {
  const sender: SenderAccount = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const senders = readSenders()
  senders.push(sender)
  writeSenders(senders)
  return sender
}

export function updateSender(
  id: string,
  patch: Partial<Omit<SenderAccount, "id" | "createdAt">>,
): SenderAccount | null {
  const senders = readSenders()
  const idx = senders.findIndex((s) => s.id === id)
  if (idx === -1) return null
  senders[idx] = { ...senders[idx], ...patch }
  writeSenders(senders)
  return senders[idx]
}

export function deleteSender(id: string): boolean {
  const senders = readSenders()
  const filtered = senders.filter((s) => s.id !== id)
  if (filtered.length === senders.length) return false
  writeSenders(filtered)
  return true
}

// ─── Setup persistence ────────────────────────────────────────────────────────

export function readSetups(): DispatchSetup[] {
  if (!fs.existsSync(SETUPS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(SETUPS_FILE, "utf-8")) as DispatchSetup[]
  } catch {
    return []
  }
}

export function writeSetups(setups: DispatchSetup[]): void {
  fs.writeFileSync(SETUPS_FILE, JSON.stringify(setups, null, 2), "utf-8")
}

export function createSetup(
  data: Omit<DispatchSetup, "id" | "createdAt" | "lastSentDate" | "lastSentAt">,
): DispatchSetup {
  const setup: DispatchSetup = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lastSentDate: null,
    lastSentAt: null,
  }
  const setups = readSetups()
  setups.push(setup)
  writeSetups(setups)
  return setup
}

export function updateSetup(
  id: string,
  patch: Partial<Omit<DispatchSetup, "id" | "createdAt">>,
): DispatchSetup | null {
  const setups = readSetups()
  const idx = setups.findIndex((s) => s.id === id)
  if (idx === -1) return null
  setups[idx] = { ...setups[idx], ...patch }
  writeSetups(setups)
  return setups[idx]
}

export function deleteSetup(id: string): boolean {
  const setups = readSetups()
  const filtered = setups.filter((s) => s.id !== id)
  if (filtered.length === setups.length) return false
  writeSetups(filtered)
  return true
}

// ─── File discovery ───────────────────────────────────────────────────────────

/** Lists all daily folders sorted newest-first */
export function listDayFolders(): { dateStr: string; folderName: string }[] {
  if (!fs.existsSync(MOM_BASE_DIR)) return []
  const entries = fs.readdirSync(MOM_BASE_DIR, { withFileTypes: true })
  const result: { dateStr: string; folderName: string }[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const m = e.name.match(/(\d{8})核算单$/)
    if (m) result.push({ dateStr: m[1], folderName: e.name })
  }
  result.sort((a, b) => b.dateStr.localeCompare(a.dateStr))
  return result
}

/** Returns trader codes available in the latest daily folder */
export function browseLatestTraders(): {
  traderCode: string
  fileName: string
  dateStr: string
}[] {
  const days = listDayFolders()
  if (days.length === 0) return []
  const { dateStr, folderName } = days[0]
  const dir = path.join(MOM_BASE_DIR, folderName)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx"))
  return files
    .map((fileName) => {
      const m = fileName.match(/核算信息_([^_]+)_\d{8}_/)
      return { traderCode: m?.[1] ?? "", fileName, dateStr }
    })
    .filter((r) => r.traderCode)
}

/** Finds the xlsx file for a trader in the most recent available folder */
export function findTraderFile(
  traderCode: string,
): { filePath: string; dateStr: string; fileName: string } | null {
  const days = listDayFolders()
  for (const day of days) {
    const dir = path.join(MOM_BASE_DIR, day.folderName)
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir)
    const match = files.find((f) => f.includes(`_${traderCode}_`) && f.endsWith(".xlsx"))
    if (match) return { filePath: path.join(dir, match), dateStr: day.dateStr, fileName: match }
  }
  return null
}

// ─── SMTP helpers ─────────────────────────────────────────────────────────────

function resolveSmtp(senderId: string | null): {
  host: string
  port: number
  user: string
  pass: string
  secure: boolean
} {
  // If senderId is set, look up saved account
  if (senderId) {
    const sender = readSenders().find((s) => s.id === senderId)
    if (!sender) throw new Error(`发件账号 (id: ${senderId}) 不存在，请更新发送配置。`)
    return { host: sender.host, port: sender.port, user: sender.user, pass: sender.pass, secure: sender.secure }
  }

  // Fall back to environment variables
  const host = process.env.SMTP_HOST ?? ""
  const port = Number(process.env.SMTP_PORT ?? 465)
  const user = process.env.SMTP_USER ?? ""
  const pass = process.env.SMTP_PASS ?? ""
  const secure = process.env.SMTP_SECURE !== "false"

  if (!host || !user || !pass) {
    throw new Error("SMTP 配置不完整，请添加发件账号或在服务器环境变量中配置 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS。")
  }

  return { host, port, user, pass, secure }
}

export async function testSenderConnection(senderId: string): Promise<void> {
  const smtp = resolveSmtp(senderId)
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  await transporter.verify()
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export async function sendDispatch(
  setup: DispatchSetup,
): Promise<{ messageId: string; dateStr: string; fileName: string }> {
  const smtp = resolveSmtp(setup.senderId ?? null)

  const fileInfo = findTraderFile(setup.traderCode)
  if (!fileInfo) {
    throw new Error(
      `未找到投顾 ${setup.traderCode} 的核算文件，请确认 03.投顾逐日 目录中存在对应文件。`,
    )
  }

  const { dateStr, fileName, filePath } = fileInfo
  const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`

  const resolvedSubject = setup.subject
    .replace(/\[日期\]|\{date\}/g, formattedDate)
    .replace(/\[投顾代码\]|\{traderCode\}/g, setup.traderCode)

  const resolvedContent = setup.content
    .replace(/\[日期\]|\{date\}/g, formattedDate)
    .replace(/\[投顾代码\]|\{traderCode\}/g, setup.traderCode)
    .replace(/\[文件名\]|\{filename\}/g, fileName)

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  })

  const info = await transporter.sendMail({
    from: smtp.user,
    to: setup.to.join(", "),
    subject: resolvedSubject,
    html: resolvedContent.replace(/\n/g, "<br>"),
    attachments: [{ filename: fileName, path: filePath }],
  })

  return { messageId: info.messageId as string, dateStr, fileName }
}

// ─── Scheduler helper ─────────────────────────────────────────────────────────

/** Called every minute by the cron job; sends any setup due for this HH:MM */
export async function runDueSetups(): Promise<void> {
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`

  const setups = readSetups()
  let changed = false

  for (const setup of setups) {
    if (!setup.enabled) continue
    if (setup.scheduleTime !== hhmm) continue
    if (setup.lastSentDate === today) continue // already sent today

    try {
      await sendDispatch(setup)
      setup.lastSentDate = today
      setup.lastSentAt = now.toISOString()
      changed = true
    } catch (e) {
      console.error(`[email-dispatch] Failed for setup "${setup.name}" (${setup.id}):`, e)
    }
  }

  if (changed) writeSetups(setups)
}
