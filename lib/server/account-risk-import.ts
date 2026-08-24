import { randomUUID } from "crypto"
import { spawn, spawnSync } from "child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import * as XLSX from "xlsx"

import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import {
  addFilesToBook,
  bookDir,
  bookSource,
  adoptLegacyCfmmcFiles,
  createCfmmcImportBook,
  createEmailImportBook,
  ensureUngroupedBook,
  getImportBook,
  listImportBooks,
  pruneEmptyLegacyBooks,
  pruneMissingBookFiles,
  reassignFilesToBook,
  reassignFilesToExistingBook,
  listSpreadsheetRelPaths,
  removeFileFromBooks,
  safeResolveRel,
  statRelFile,
  type ImportBook,
  type ImportBookSource,
} from "@/lib/server/account-risk-books"
import { appendJobLog } from "@/lib/server/account-risk-job-log"

function runPythonLogged(
  python: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { env, windowsHide: true })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error("获取超时")))
    }, timeoutMs)
    child.stdout.on("data", (buf: Buffer) => { stdout += buf.toString("utf8") })
    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8")
      stderr += text
      for (const line of text.split(/\r?\n/)) {
        const msg = line.trim()
        if (msg) appendJobLog("fetch", msg)
      }
    })
    child.on("error", (err) => finish(() => reject(err)))
    child.on("close", (code) => {
      if (code === 0 || stdout.trim()) finish(() => resolve({ stdout, stderr }))
      else finish(() => reject(new Error(stderr.trim().slice(0, 800) || `exit ${code}`)))
    })
  })
}

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

function shanghaiWeekday(now = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(now)
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd)
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

function formatLocalDate(date: Date): string {
  return shanghaiParts(date).dateKey
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
  const sched = normalizeScheduleTime(scheduleTime)
  const { dateKey, hhmm } = shanghaiParts(now)
  if (hhmm < sched) return false

  const lastAt = lastFetchAt ? new Date(lastFetchAt) : null
  if (lastAt && !Number.isNaN(lastAt.getTime())) {
    const last = shanghaiParts(lastAt)
    // A morning 立即获取 must not cancel the 17:00 job. Only a run at/after
    // today's scheduled time counts as "already done today".
    if (last.dateKey === dateKey && last.hhmm >= sched) {
      if (lastFetchDate === dateKey) return false
      if (now.getTime() - lastAt.getTime() < AUTO_FETCH_RETRY_INTERVAL_MS) return false
    }
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

function pythonHasModule(python: string, moduleName: string): boolean {
  try {
    const r = spawnSync(python, ["-c", `import ${moduleName}`], {
      timeout: 8000,
      windowsHide: true,
      encoding: "utf8",
    })
    return r.status === 0
  } catch {
    return false
  }
}

function pythonCandidates(): string[] {
  const cwd = process.cwd()
  const preferred = [process.env.PYTHON_EXECUTABLE, process.env.PYTHON_EXE].filter(
    (p): p is string => !!p && p.trim().length > 0,
  )
  const local =
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
  const fallback = process.platform === "win32" ? "python" : "python3"
  return [...new Set([...preferred, ...local.filter((p) => existsSync(p)), fallback])]
}

function findPython(): string {
  const candidates = pythonCandidates()
  const withPlaywright = candidates.find((p) => pythonHasModule(p, "playwright"))
  return withPlaywright || candidates[0] || (process.platform === "win32" ? "python" : "python3")
}

function playwrightDirHasBrowser(dir: string): boolean {
  if (!dir || !path.isAbsolute(dir) || !existsSync(dir)) return false
  try {
    return readdirSync(dir).some((name) => name.startsWith("chromium"))
  } catch {
    return false
  }
}

function resolvePlaywrightBrowsersPath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "ms-playwright")
      : "",
    process.platform === "win32"
      ? path.join(process.env.USERPROFILE || "", "ms-playwright")
      : path.join(process.env.HOME || "", ".cache", "ms-playwright"),
    path.join(process.cwd(), "ms-playwright"),
  ]
  return candidates.find((dir) => !!dir && playwrightDirHasBrowser(dir))
}

function cfmmcFetchEnv(account: CfmmcAccount): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CFMMC_USER: account.userId,
    CFMMC_PASSWORD: account.password,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  }
  const browsers = resolvePlaywrightBrowsersPath()
  if (browsers) env.PLAYWRIGHT_BROWSERS_PATH = browsers
  else delete env.PLAYWRIGHT_BROWSERS_PATH
  return env
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

export type ListedImportFile = DownloadedFile & { rel: string; bookId: string | null; bookName: string | null }

function fileBelongsToUser(rel: string, userId: string): boolean {
  const base = path.basename(rel.replace(/\\/g, "/"))
  return base.startsWith(`${userId}_`) || base.startsWith(`${userId}.`)
}

/** Official 监控中心 fetch names: `{uid}_{YYYY-MM-DD}.xls` or `{uid}_{uid}_{date}.xls`. */
function isCfmmcFetchFilename(rel: string, userId: string): boolean {
  return officialFetchDate(rel, userId) != null
}

function officialFetchDate(rel: string, userId: string): string | null {
  const base = path.basename(rel.replace(/\\/g, "/"))
  const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const double = new RegExp(`^${escaped}_${escaped}_(\\d{4}-\\d{2}-\\d{2})\\.(xls|xlsx|xlsm)$`, "i").exec(base)
  if (double) return double[1]
  const single = new RegExp(`^${escaped}_(\\d{4}-\\d{2}-\\d{2})\\.(xls|xlsx|xlsm)$`, "i").exec(base)
  return single?.[1] ?? null
}

function latestCfmmcFileDate(userId: string): string | null {
  const uid = userId.trim()
  if (!uid) return null
  let latest: string | null = null
  for (const rel of listSpreadsheetRelPaths(accountRiskImportDir())) {
    const d = officialFetchDate(rel, uid)
    if (d && (!latest || d > latest)) latest = d
  }
  return latest
}

function normalizeYmd(raw: string): string | null {
  const m = raw.replace(/\//g, "-").split(" ")[0].match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

function readInnerTradeDate(filePath: string): string | null {
  try {
    const buf = readFileSync(filePath)
    const utf16 = buf.toString("utf16le")
    const idx = utf16.indexOf("交易日期")
    if (idx >= 0) {
      const nearby = normalizeYmd(utf16.slice(idx, idx + 48))
      if (nearby) return nearby
    }
  } catch {
    // fall through to xlsx
  }
  try {
    const wb = XLSX.readFile(filePath, { cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0] ?? ""]
    if (!ws?.["!ref"]) return null
    const range = XLSX.utils.decode_range(ws["!ref"])
    for (let r = 0; r <= Math.min(range.e.r, 20); r++) {
      for (let c = 0; c <= Math.min(range.e.c, 11); c++) {
        const label = String(ws[XLSX.utils.encode_cell({ r, c })]?.v ?? "").trim()
        if (!label.includes("交易日期")) continue
        for (let dc = c + 1; dc <= Math.min(range.e.c, c + 3); dc++) {
          const cell = ws[XLSX.utils.encode_cell({ r, dc })]
          if (cell?.v == null || cell.v === "") continue
          if (cell.v instanceof Date) {
            const d = cell.v
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
          }
          const got = normalizeYmd(String(cell.v))
          if (got) return got
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/** Drop official fetch files whose inner 交易日期 does not match the filename. */
function purgeMismatchedCfmmcFetchFiles(folder: string): number {
  let removed = 0
  for (const account of readCfmmcConfig().accounts) {
    const uid = account.userId.trim()
    if (!uid) continue
    for (const rel of listSpreadsheetRelPaths(folder)) {
      const want = officialFetchDate(rel, uid)
      if (!want) continue
      const resolved = safeResolveRel(folder, rel)
      if (!resolved) continue
      const got = readInnerTradeDate(resolved)
      if (!got || got === want) continue
      try {
        unlinkSync(resolved)
        removeFileFromBooks(rel)
        removed += 1
      } catch {
        // keep listing
      }
    }
  }
  if (removed > 0) {
    appendJobLog("fetch", `已删除 ${removed} 个文件名与文件内交易日期不符的重复日报`)
  }
  return removed
}

function bookOwningRel(rel: string): ImportBook | undefined {
  const n = rel.replace(/\\/g, "/")
  const base = path.basename(n)
  return listImportBooks().find((b) => b.files.some((f) => {
    const fn = f.replace(/\\/g, "/")
    return fn === n || fn === base || path.basename(fn) === base
  }))
}

function groupFilesForCfmmcAccount(account: CfmmcAccount, extraRels: string[] = []): ImportBook | null {
  const uid = account.userId.trim()
  if (!uid) return null
  const folder = accountRiskImportDir()
  const book = createCfmmcImportBook(uid, account.label)
  const rels = new Set<string>()
  for (const raw of extraRels) {
    const n = raw.replace(/\\/g, "/").replace(/^\/+/, "")
    if (n) rels.add(path.basename(n))
  }
  for (const rel of listSpreadsheetRelPaths(folder)) {
    if (!fileBelongsToUser(rel, uid)) continue
    if (isCfmmcFetchFilename(rel, uid)) {
      rels.add(rel)
      continue
    }
    const owner = bookOwningRel(rel)
    if (owner && bookSource(owner) === "email") continue
    if (owner && bookSource(owner) === "upload" && owner.id !== "ungrouped") continue
    if (
      !owner ||
      owner.id === "ungrouped" ||
      bookSource(owner) === "cfmmc" ||
      owner.name === uid ||
      owner.name === `监控中心 ${uid}`
    ) {
      rels.add(rel)
    }
  }
  if (rels.size === 0) return book
  return reassignFilesToExistingBook(book.id, [...rels])
}

/** Split 监控中心 downloads out of 拖入命名账户; never steal 拖入 files. */
function repairCfmmcBooks() {
  const cfg = readCfmmcConfig()
  for (const account of cfg.accounts) {
    try {
      const uid = account.userId.trim()
      if (!uid) continue
      const book = createCfmmcImportBook(uid, account.label)
      adoptLegacyCfmmcFiles(uid, book.id)
      groupFilesForCfmmcAccount(account)
    } catch {
      // keep listing
    }
  }
}

export function listImportedFiles(): { files: ListedImportFile[]; folder: string; books: ImportBook[] } {
  const folder = accountRiskImportDir()
  purgeMismatchedCfmmcFetchFiles(folder)
  ensureUngroupedBook(folder)
  pruneMissingBookFiles(folder)
  repairCfmmcBooks()
  pruneEmptyLegacyBooks()
  const books = listImportBooks()
  const bookByRel = new Map<string, ImportBook>()
  const namedLast = [...books.filter((b) => b.id === "ungrouped"), ...books.filter((b) => b.id !== "ungrouped")]
  for (const b of namedLast) {
    for (const f of b.files) bookByRel.set(f.replace(/\\/g, "/"), b)
  }
  const files: ListedImportFile[] = listSpreadsheetRelPaths(folder).map((rel) => {
    const st = statRelFile(folder, rel)
    const book = bookByRel.get(rel) ?? (rel.includes("/") ? getImportBook(rel.split("/")[0]) : getImportBook("ungrouped"))
    return {
      name: rel,
      rel,
      size: st?.size ?? 0,
      mtime: st?.mtime ?? "",
      bookId: book?.id ?? null,
      bookName: book?.name ?? null,
    }
  }).sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""))
  return { files, folder, books }
}

export function assignImportedFilesToBook(opts: {
  name?: string
  bookId?: string
  files?: string[]
}): { book: ImportBook; assigned: number } {
  const { files } = listImportedFiles()
  const ungrouped = files.filter((f) => (f.bookId ?? "ungrouped") === "ungrouped")
  const requested = opts.files?.length
    ? files.filter((f) => opts.files!.includes(f.rel) || opts.files!.includes(path.basename(f.rel)))
    : ungrouped
  if (requested.length === 0) throw new Error("没有可命名的文件")
  const fromId = opts.bookId?.trim()
  const name = (opts.name ?? "").trim() || (fromId ? getImportBook(fromId)?.name ?? "" : "")
  if (!name) throw new Error("请填写账户名称")
  const book = reassignFilesToBook(requested.map((f) => f.rel), name)
  return { book, assigned: requested.length }
}

export function deleteImportedFile(file: string): string {
  const folder = accountRiskImportDir()
  const filePath = safeResolveRel(folder, file) ?? safeResolveInDir(folder, file)
  if (!filePath) throw new Error("非法路径")
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error("文件不存在")
  unlinkSync(filePath)
  const rel = path.relative(folder, filePath).replace(/\\/g, "/")
  removeFileFromBooks(rel)
  return rel
}

/** Delete every spreadsheet in the 单账户 import dir. Never touches MOM folders. */
export function deleteAllImportedFiles(): string[] {
  const { files } = listImportedFiles()
  const deleted: string[] = []
  for (const f of files) {
    deleted.push(deleteImportedFile(f.rel))
  }
  return deleted
}

/** Delete only files that belong to one import source (拖入 / 邮箱 / 监控中心). */
export function deleteImportedFilesForSource(source: ImportBookSource): string[] {
  const { files, books } = listImportedFiles()
  const deleted: string[] = []
  for (const f of files) {
    const book = books.find((b) => b.id === (f.bookId ?? "ungrouped"))
    const belongs = book ? bookSource(book) === source : source === "upload"
    if (!belongs) continue
    deleted.push(deleteImportedFile(f.rel))
  }
  return deleted
}

export async function saveUploadedFiles(
  files: File[],
  book: ImportBook,
): Promise<{ saved: string[]; errors: string[]; skipped: string[]; book: ImportBook }> {
  const folder = accountRiskImportDir()
  const destDir = bookDir(folder, book.id)
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
      const rel = `${book.id}/${safeName}`
      writeFileSync(path.join(destDir, safeName), Buffer.from(await file.arrayBuffer()))
      saved.push(rel)
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "写入失败"}`)
    }
  }
  const updated = addFilesToBook(book.id, saved)
  return { saved, errors, skipped, book: updated }
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

  const book = createEmailImportBook(cfg.email)
  const folder = accountRiskImportDir()
  const dlDir = bookDir(folder, book.id)
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

  if (downloaded.length > 0) {
    addFilesToBook(book.id, downloaded.map((name) => `${book.id}/${path.basename(name)}`))
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

function parseJsonLine(stdout: string): {
  ok: boolean
  file?: string
  filename?: string
  files?: string[]
  downloaded?: number
  skipped?: number
  discarded?: number
  haveToday?: boolean
  today?: string
  error?: string
} {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  try {
    return JSON.parse(last) as {
      ok: boolean
      file?: string
      filename?: string
      files?: string[]
      downloaded?: number
      skipped?: number
      discarded?: number
      haveToday?: boolean
      today?: string
      error?: string
    }
  } catch {
    throw new Error(stdout.trim() || "监控中心脚本无输出")
  }
}

function attachFetchedFiles(account: CfmmcAccount, filenames: string[]) {
  return groupFilesForCfmmcAccount(account, filenames)
}

async function runEtlAfterFetch(bookId?: string, userId?: string) {
  appendJobLog("etl", "开始增量计算刚获取的文件…")
  const { runCfmmcETL } = await import("@/lib/server/cfmmc-etl")
  const result = await runCfmmcETL("incremental", { bookId, userId })
  appendJobLog("etl", `计算完成：处理 ${result.processed}，新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`)
  for (const err of result.errors) appendJobLog("etl", err)
  return result
}

export async function fetchCfmmcAccount(
  accountId: string,
  mode: "history" | "incremental" | "latest" = "history",
): Promise<{
  ok: boolean
  filename?: string
  downloaded?: number
  skipped?: number
  discarded?: number
  bookId?: string
  etlProcessed?: number
  etlError?: string
  error?: string
}> {
  const cfg = readCfmmcConfig()
  const account = cfg.accounts.find((a) => a.id === accountId)
  if (!account) throw new Error("账户不存在")
  if (!account.userId || !account.password) throw new Error("账户缺少用户名或密码")

  const script = path.join(process.cwd(), "scripts", "ma", "cfmmc_fetch.py")
  if (!existsSync(script)) throw new Error(`脚本不存在: ${script}`)

  const python = findPython()
  const outDir = accountRiskImportDir()
  const applyResult = (result: {
    ok: boolean
    filename?: string
    files?: string[]
    downloaded?: number
    skipped?: number
    discarded?: number
    haveToday?: boolean
    error?: string
  }) => {
    const now = new Date()
    const next = readCfmmcConfig()
    const idx = next.accounts.findIndex((a) => a.id === accountId)
    let bookId: string | undefined
    if (result.ok) {
      const book = attachFetchedFiles(account, result.files ?? (result.filename ? [result.filename] : []))
      bookId = book?.id
      const discardedBit = result.discarded ? `，无结算/日期不符 ${result.discarded}` : ""
      appendJobLog(
        "fetch",
        `账户「${account.label || account.userId}」现有 ${book?.files.length ?? 0} 个文件（新下载 ${result.downloaded ?? result.files?.length ?? 0}，磁盘已有 ${result.skipped ?? 0}${discardedBit}）`,
      )
    }
    if (idx >= 0) {
      const todayIso = latestCfmmcFileDate(account.userId)
      const shanghaiToday = (() => {
        const { dateKey } = shanghaiParts(now)
        return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`
      })()
      const haveToday = result.haveToday === true || todayIso === shanghaiToday
      const expectToday = shanghaiWeekday(now) >= 1 && shanghaiWeekday(now) <= 5
      next.accounts[idx] = {
        ...next.accounts[idx],
        lastFetchAt: now.toISOString(),
        lastFetchDate: result.ok && (haveToday || !expectToday) ? formatLocalDate(now) : next.accounts[idx].lastFetchDate,
        lastError: result.ok
          ? (expectToday && !haveToday ? `未拿到 ${shanghaiToday} 结算日报` : null)
          : (result.error || "获取失败"),
        lastFile: result.ok ? (result.filename || next.accounts[idx].lastFile) : next.accounts[idx].lastFile,
      }
      next.lastRunAt = now.toISOString()
      writeCfmmcConfig(next)
    }
    return result.ok
      ? {
          ok: true as const,
          filename: result.filename,
          downloaded: result.downloaded ?? result.files?.length ?? (result.filename ? 1 : 0),
          skipped: result.skipped ?? 0,
          discarded: result.discarded ?? 0,
          bookId,
        }
      : { ok: false as const, error: result.error || "获取失败" }
  }
  const finish = async (base: Awaited<ReturnType<typeof applyResult>>) => {
    if (!base.ok) return base
    try {
      const etl = await runEtlAfterFetch(base.bookId, account.userId)
      return { ...base, etlProcessed: etl.processed }
    } catch (e) {
      return { ...base, etlError: e instanceof Error ? e.message : String(e) }
    }
  }
  const args = [script, "--out-dir", outDir]
  const incremental = mode !== "history"
  if (mode === "history") {
    args.push("--history", "--days", "65")
  } else {
    args.push("--incremental", "--days", "10")
    const since = latestCfmmcFileDate(account.userId)
    if (since) args.push("--since", since)
  }
  appendJobLog("fetch", `开始获取 ${account.label || account.userId}（${incremental ? "增量" : "全部历史"}，Python ${python}）…`)
  try {
    const { stdout } = await runPythonLogged(
      python,
      args,
      cfmmcFetchEnv(account),
      mode === "history" ? 1_200_000 : 600_000,
    )
    return finish(applyResult(parseJsonLine(stdout)))
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    if (typeof err.stdout === "string" && err.stdout.trim()) {
      try {
        return finish(applyResult(parseJsonLine(err.stdout)))
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
    appendJobLog("fetch", `失败: ${message}`)
    return finish(applyResult({ ok: false, error: message }))
  }
}

export async function fetchCfmmcAccounts(accountId?: string): Promise<{
  results: {
    id: string
    label: string
    userId: string
    ok: boolean
    filename?: string
    downloaded?: number
    skipped?: number
    discarded?: number
    bookId?: string
    etlProcessed?: number
    etlError?: string
    error?: string
  }[]
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
      const r = await fetchCfmmcAccount(account.id, "history")
      results.push({
        id: account.id,
        label: account.label,
        userId: account.userId,
        ok: r.ok,
        filename: r.filename,
        downloaded: r.downloaded,
        skipped: r.skipped,
        discarded: r.discarded,
        bookId: r.bookId,
        etlProcessed: r.etlProcessed,
        etlError: r.etlError,
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
  const names = due.map((a) => a.label || a.userId).join("、")
  console.log(`[account-risk-cfmmc] scheduled ${cfg.scheduleTime} fetch starting for ${due.length} account(s)`)
  appendJobLog("fetch", `定时任务触发（北京时间 ${cfg.scheduleTime}），增量获取 ${names}`)
  cfmmcFetchRunning = true
  try {
    for (const account of due) {
      await fetchCfmmcAccount(account.id, "incremental")
    }
  } finally {
    cfmmcFetchRunning = false
  }
}
