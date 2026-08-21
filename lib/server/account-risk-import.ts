import { randomUUID } from "crypto"
import { execFile } from "child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { promisify } from "util"

import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"

const execFileAsync = promisify(execFile)

export type AccountRiskEmailConfig = {
  email: string
  pass: string
  imapHost: string
  imapPort: number
  enabled: boolean
  scheduleTime: string
  sender: string
  lastFetchDate: string | null
  lastFetchAt: string | null
}

export type CfmmcAccount = {
  id: string
  label: string
  userId: string
  password: string
  enabled: boolean
  lastFetchDate: string | null
  lastFetchAt: string | null
  lastError: string | null
  lastFile: string | null
}

export type CfmmcConfig = {
  enabled: boolean
  scheduleTime: string
  lastRunAt: string | null
  accounts: CfmmcAccount[]
}

export type FetchResult = {
  downloaded: string[]
  skipped: string[]
  errors: string[]
  log: string[]
}

export type DownloadedFile = {
  name: string
  size: number
  mtime: string
  source?: string
}

const DATA_ROOT = path.join(process.cwd(), "data", "account-risk")
const EMAIL_CONFIG_FILE = path.join(DATA_ROOT, "email_config.json")
const CFMMC_CONFIG_FILE = path.join(DATA_ROOT, "cfmmc_config.json")

const DEFAULT_EMAIL: AccountRiskEmailConfig = {
  email: "",
  pass: "",
  imapHost: "imap.163.com",
  imapPort: 993,
  enabled: false,
  scheduleTime: "17:00",
  sender: "",
  lastFetchDate: null,
  lastFetchAt: null,
}

const DEFAULT_CFMMC: CfmmcConfig = {
  enabled: false,
  scheduleTime: "17:00",
  lastRunAt: null,
  accounts: [],
}

const AUTO_FETCH_RETRY_INTERVAL_MS = 60 * 60 * 1000
const SPREADSHEET_EXT = new Set([".xls", ".xlsx", ".xlsm"])

let cfmmcFetchRunning = false

export function accountRiskImportDir(): string {
  const fromEnv = process.env.ACCOUNT_RISK_DATA_DIR?.trim()
  const dir = fromEnv || path.join(DATA_ROOT, "imports")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function ensureDataRoot() {
  if (!existsSync(DATA_ROOT)) mkdirSync(DATA_ROOT, { recursive: true })
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
}

function isMaskedSecret(value: string | undefined): boolean {
  return !value || value.startsWith("•")
}

function parseSchedule(time: string): { h: number; m: number } {
  const [h, m] = (time || "17:00").split(":").map(Number)
  return { h: Number.isFinite(h) ? h : 17, m: Number.isFinite(m) ? m : 0 }
}

function normalizeScheduleTime(time: string): string {
  const { h, m } = parseSchedule(time)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function isDue(now: Date, scheduleTime: string, lastFetchDate: string | null, lastFetchAt: string | null): boolean {
  const { h, m } = parseSchedule(scheduleTime)
  const todayStr = formatLocalDate(now)
  if (lastFetchDate === todayStr) return false
  if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return false
  const lastAt = lastFetchAt ? new Date(lastFetchAt) : null
  if (lastAt && !Number.isNaN(lastAt.getTime()) && formatLocalDate(lastAt) === todayStr) {
    if (now.getTime() - lastAt.getTime() < AUTO_FETCH_RETRY_INTERVAL_MS) return false
  }
  return true
}

function safeResolveInDir(dir: string, file: string): string | null {
  const resolved = path.resolve(dir, path.basename(file))
  const root = path.resolve(dir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function isSpreadsheetName(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return SPREADSHEET_EXT.has(ext) && !name.startsWith("~$")
}

function findPython(): string {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE
  if (process.env.PYTHON_EXE) return process.env.PYTHON_EXE
  const cwd = process.cwd()
  const candidates =
    process.platform === "win32"
      ? [
          path.join(cwd, ".venv", "Scripts", "python.exe"),
          path.join(cwd, "auto_login", ".venv", "Scripts", "python.exe"),
          path.join(cwd, "..", "auto_login", ".venv", "Scripts", "python.exe"),
        ]
      : [
          path.join(cwd, ".venv", "bin", "python3"),
          path.join(cwd, ".venv", "bin", "python"),
        ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return process.platform === "win32" ? "python" : "python3"
}

// ── email config ──────────────────────────────────────────────────────────────

export function readEmailConfig(): AccountRiskEmailConfig {
  if (!existsSync(EMAIL_CONFIG_FILE)) return { ...DEFAULT_EMAIL }
  try {
    const raw = JSON.parse(readFileSync(EMAIL_CONFIG_FILE, "utf-8")) as Partial<AccountRiskEmailConfig>
    return { ...DEFAULT_EMAIL, ...raw }
  } catch {
    return { ...DEFAULT_EMAIL }
  }
}

export function writeEmailConfig(cfg: AccountRiskEmailConfig): void {
  ensureDataRoot()
  writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8")
}

export function publicEmailConfig(): AccountRiskEmailConfig {
  const cfg = readEmailConfig()
  return { ...cfg, pass: cfg.pass ? "••••••••" : "" }
}

export function saveEmailConfig(body: Partial<AccountRiskEmailConfig>): AccountRiskEmailConfig {
  const current = readEmailConfig()
  const updated: AccountRiskEmailConfig = {
    ...current,
    email: typeof body.email === "string" ? body.email.trim() : current.email,
    imapHost: typeof body.imapHost === "string" ? body.imapHost.trim() : current.imapHost,
    imapPort: typeof body.imapPort === "number" ? body.imapPort : current.imapPort,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    scheduleTime: typeof body.scheduleTime === "string" ? normalizeScheduleTime(body.scheduleTime) : current.scheduleTime,
    sender: typeof body.sender === "string" ? body.sender.trim() : current.sender,
  }
  if (typeof body.pass === "string" && !isMaskedSecret(body.pass)) {
    updated.pass = body.pass
  }
  writeEmailConfig(updated)
  return updated
}

// ── CFMMC config ──────────────────────────────────────────────────────────────

export function readCfmmcConfig(): CfmmcConfig {
  if (!existsSync(CFMMC_CONFIG_FILE)) return { ...DEFAULT_CFMMC, accounts: [] }
  try {
    const raw = JSON.parse(readFileSync(CFMMC_CONFIG_FILE, "utf-8")) as Partial<CfmmcConfig>
    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.map((a) => ({
          id: String(a.id || randomUUID()),
          label: String(a.label || a.userId || ""),
          userId: String(a.userId || ""),
          password: String(a.password || ""),
          enabled: a.enabled !== false,
          lastFetchDate: a.lastFetchDate ?? null,
          lastFetchAt: a.lastFetchAt ?? null,
          lastError: a.lastError ?? null,
          lastFile: a.lastFile ?? null,
        }))
      : []
    return {
      ...DEFAULT_CFMMC,
      ...raw,
      accounts,
    }
  } catch {
    return { ...DEFAULT_CFMMC, accounts: [] }
  }
}

export function writeCfmmcConfig(cfg: CfmmcConfig): void {
  ensureDataRoot()
  writeFileSync(CFMMC_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8")
}

export function publicCfmmcConfig(): CfmmcConfig {
  const cfg = readCfmmcConfig()
  return {
    ...cfg,
    accounts: cfg.accounts.map((a) => ({
      ...a,
      password: a.password ? "••••••••" : "",
    })),
  }
}

export function saveCfmmcSettings(body: { enabled?: boolean; scheduleTime?: string }): CfmmcConfig {
  const current = readCfmmcConfig()
  if (typeof body.enabled === "boolean") current.enabled = body.enabled
  if (typeof body.scheduleTime === "string" && body.scheduleTime.trim()) {
    current.scheduleTime = normalizeScheduleTime(body.scheduleTime)
  }
  writeCfmmcConfig(current)
  return current
}

export function addCfmmcAccount(input: { label?: string; userId: string; password: string; enabled?: boolean }): CfmmcAccount {
  const cfg = readCfmmcConfig()
  const userId = input.userId.trim()
  if (!userId) throw new Error("请填写监控中心用户名")
  if (!input.password.trim()) throw new Error("请填写密码")
  const account: CfmmcAccount = {
    id: randomUUID(),
    label: (input.label || userId).trim(),
    userId,
    password: input.password,
    enabled: input.enabled !== false,
    lastFetchDate: null,
    lastFetchAt: null,
    lastError: null,
    lastFile: null,
  }
  cfg.accounts.push(account)
  writeCfmmcConfig(cfg)
  return account
}

export function updateCfmmcAccount(
  id: string,
  patch: Partial<Pick<CfmmcAccount, "label" | "userId" | "password" | "enabled">>,
): CfmmcAccount {
  const cfg = readCfmmcConfig()
  const idx = cfg.accounts.findIndex((a) => a.id === id)
  if (idx < 0) throw new Error("账户不存在")
  const current = cfg.accounts[idx]
  if (typeof patch.label === "string") current.label = patch.label.trim() || current.label
  if (typeof patch.userId === "string" && patch.userId.trim()) current.userId = patch.userId.trim()
  if (typeof patch.password === "string" && !isMaskedSecret(patch.password)) current.password = patch.password
  if (typeof patch.enabled === "boolean") current.enabled = patch.enabled
  cfg.accounts[idx] = current
  writeCfmmcConfig(cfg)
  return current
}

export function deleteCfmmcAccount(id: string): void {
  const cfg = readCfmmcConfig()
  const next = cfg.accounts.filter((a) => a.id !== id)
  if (next.length === cfg.accounts.length) throw new Error("账户不存在")
  cfg.accounts = next
  writeCfmmcConfig(cfg)
}

// ── files ─────────────────────────────────────────────────────────────────────

export function listImportedFiles(): { files: DownloadedFile[]; folder: string } {
  const folder = accountRiskImportDir()
  const files: DownloadedFile[] = readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && isSpreadsheetName(e.name))
    .map((e) => {
      const stat = statSync(path.join(folder, e.name))
      return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
  return { files, folder }
}

export function deleteImportedFile(file: string): string {
  const folder = accountRiskImportDir()
  const filePath = safeResolveInDir(folder, file)
  if (!filePath) throw new Error("非法路径")
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error("文件不存在")
  unlinkSync(filePath)
  return path.basename(filePath)
}

export async function saveUploadedFiles(files: File[]): Promise<{ saved: string[]; errors: string[]; skipped: string[] }> {
  const folder = accountRiskImportDir()
  const saved: string[] = []
  const errors: string[] = []
  const skipped: string[] = []
  for (const file of files) {
    const safeName = path.basename(file.name)
    if (!isSpreadsheetName(safeName)) {
      skipped.push(file.name)
      continue
    }
    try {
      const target = path.join(folder, safeName)
      writeFileSync(target, Buffer.from(await file.arrayBuffer()))
      saved.push(safeName)
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "写入失败"}`)
    }
  }
  return { saved, errors, skipped }
}

// ── email fetch ───────────────────────────────────────────────────────────────

interface BodyPart {
  part: string
  filename: string
}

function collectSpreadsheetParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: BodyPart[] = [],
): BodyPart[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  if (fname && isSpreadsheetName(fname)) {
    out.push({ part: pathStr || "1", filename: fname })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectSpreadsheetParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

export async function fetchAccountRiskEmails(): Promise<FetchResult> {
  const cfg = readEmailConfig()
  if (!cfg.email || !cfg.pass) throw new Error("未配置邮箱账号或密码")

  const dlDir = accountRiskImportDir()
  const client = createSafeImapFlow({
    host: cfg.imapHost || "imap.163.com",
    port: cfg.imapPort || 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.pass },
    logger: false,
    label: cfg.email,
  })

  const downloaded: string[] = []
  const skipped: string[] = []
  const errors: string[] = []
  const log: string[] = []

  try {
    await client.connect()
    await client.mailboxOpen("INBOX")

    const since = new Date()
    since.setDate(since.getDate() - 3)
    const senderFilter = (cfg.sender ?? "").trim().toLowerCase()
    const allUids = await client.search({ since })
    log.push(`收件箱最近3天共 ${allUids.length} 封邮件`)
    if (senderFilter) log.push(`发件人过滤: ${senderFilter}`)

    for (const uid of allUids) {
      const envMsg = await client.fetchOne(String(uid), { envelope: true })
      const envelope = (envMsg as { envelope?: { subject?: string; from?: { address?: string }[] } }).envelope

      if (senderFilter) {
        const fromAddresses = (envelope?.from ?? []).map((f) => (f.address ?? "").toLowerCase())
        const matchesSender = fromAddresses.some((addr) => addr.includes(senderFilter) || senderFilter.includes(addr))
        if (!matchesSender) continue
        log.push(`匹配发件人: ${fromAddresses.join(", ")} | 主题: ${envelope?.subject ?? "(无主题)"}`)
      }

      const bodyMsg = await client.fetchOne(String(uid), { bodyStructure: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structure = (bodyMsg as any).bodyStructure
      if (!structure) continue
      const parts = collectSpreadsheetParts(structure)
      if (parts.length === 0) continue
      log.push(`  → 找到 ${parts.length} 个表格附件`)

      for (const { part, filename } of parts) {
        try {
          const dl = await client.download(String(uid), part)
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
          const buf = Buffer.concat(chunks)
          const outName = path.basename(filename)
          const outPath = path.join(dlDir, outName)
          if (existsSync(outPath)) {
            skipped.push(`${outName} (已存在)`)
            continue
          }
          writeFileSync(outPath, buf)
          downloaded.push(outName)
        } catch (e) {
          errors.push(`${filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } finally {
    await closeImapFlow(client)
  }

  const now = new Date()
  writeEmailConfig({
    ...cfg,
    lastFetchDate: downloaded.length > 0 ? formatLocalDate(now) : cfg.lastFetchDate,
    lastFetchAt: now.toISOString(),
  })
  return { downloaded, skipped, errors, log }
}

export async function runDueAccountRiskEmailFetch(): Promise<void> {
  const cfg = readEmailConfig()
  if (!cfg.enabled || !cfg.email || !cfg.pass) return
  if (!isDue(new Date(), cfg.scheduleTime, cfg.lastFetchDate, cfg.lastFetchAt)) return
  await fetchAccountRiskEmails()
}

// ── CFMMC fetch ───────────────────────────────────────────────────────────────

function parseJsonLine(stdout: string): { ok: boolean; file?: string; filename?: string; error?: string } {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  try {
    return JSON.parse(last) as { ok: boolean; file?: string; filename?: string; error?: string }
  } catch {
    throw new Error(stdout.trim() || "监控中心脚本无输出")
  }
}

export async function fetchCfmmcAccount(accountId: string): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const cfg = readCfmmcConfig()
  const account = cfg.accounts.find((a) => a.id === accountId)
  if (!account) throw new Error("账户不存在")
  if (!account.userId || !account.password) throw new Error("账户缺少用户名或密码")

  const script = path.join(process.cwd(), "scripts", "ma", "cfmmc_fetch.py")
  if (!existsSync(script)) throw new Error(`脚本不存在: ${script}`)

  const python = findPython()
  const outDir = accountRiskImportDir()
  const applyResult = (result: { ok: boolean; filename?: string; error?: string }) => {
    const now = new Date()
    const next = readCfmmcConfig()
    const idx = next.accounts.findIndex((a) => a.id === accountId)
    if (idx >= 0) {
      next.accounts[idx] = {
        ...next.accounts[idx],
        lastFetchAt: now.toISOString(),
        lastFetchDate: result.ok ? formatLocalDate(now) : next.accounts[idx].lastFetchDate,
        lastError: result.ok ? null : (result.error || "获取失败"),
        lastFile: result.ok ? (result.filename || null) : next.accounts[idx].lastFile,
      }
      next.lastRunAt = now.toISOString()
      writeCfmmcConfig(next)
    }
    return result.ok
      ? { ok: true as const, filename: result.filename }
      : { ok: false as const, error: result.error || "获取失败" }
  }
  try {
    const { stdout, stderr } = await execFileAsync(python, [script, "--out-dir", outDir], {
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CFMMC_USER: account.userId,
        CFMMC_PASSWORD: account.password,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    })
    if (stderr?.trim()) console.warn(`[cfmmc-fetch ${account.userId}] ${stderr.trim().slice(0, 2000)}`)
    return applyResult(parseJsonLine(stdout))
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    if (typeof err.stdout === "string" && err.stdout.trim()) {
      try {
        return applyResult(parseJsonLine(err.stdout))
      } catch {
        // fall through to generic error
      }
    }
    const message =
      (typeof err.stderr === "string" && err.stderr.trim())
        ? err.stderr.trim().slice(0, 800)
        : e instanceof Error
          ? e.message
          : String(e)
    return applyResult({ ok: false, error: message })
  }
}

export async function fetchCfmmcAccounts(accountId?: string): Promise<{
  results: { id: string; label: string; userId: string; ok: boolean; filename?: string; error?: string }[]
}> {
  if (cfmmcFetchRunning) throw new Error("监控中心获取正在进行中，请稍后再试")
  cfmmcFetchRunning = true
  try {
    const cfg = readCfmmcConfig()
    const targets = accountId
      ? cfg.accounts.filter((a) => a.id === accountId)
      : cfg.accounts.filter((a) => a.enabled)
    if (targets.length === 0) throw new Error(accountId ? "账户不存在" : "没有已启用的账户")
    const results = []
    for (const account of targets) {
      const r = await fetchCfmmcAccount(account.id)
      results.push({
        id: account.id,
        label: account.label,
        userId: account.userId,
        ok: r.ok,
        filename: r.filename,
        error: r.error,
      })
    }
    return { results }
  } finally {
    cfmmcFetchRunning = false
  }
}

export async function runDueCfmmcFetch(): Promise<void> {
  const cfg = readCfmmcConfig()
  if (!cfg.enabled || cfmmcFetchRunning) return
  const now = new Date()
  const due = cfg.accounts.filter(
    (a) => a.enabled && a.userId && a.password && isDue(now, cfg.scheduleTime, a.lastFetchDate, a.lastFetchAt),
  )
  if (due.length === 0) return
  cfmmcFetchRunning = true
  try {
    for (const account of due) {
      await fetchCfmmcAccount(account.id)
    }
  } finally {
    cfmmcFetchRunning = false
  }
}
