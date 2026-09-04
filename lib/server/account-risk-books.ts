/**
 * Named import books for 单账户 drag-in files.
 * Files live under data/account-risk/imports/<bookId>/ ; registry is import_books.json.
 */
import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"

export type ImportBookSource = "upload" | "email" | "cfmmc"

export type ImportBook = {
  id: string
  name: string
  createdAt: string
  files: string[]
  /** upload = 拖入命名；email = 邮箱获取；cfmmc = 监控中心自动获取. Missing = treat as upload. */
  source?: ImportBookSource
  cfmmcUserId?: string
}

export function bookSource(b: ImportBook): ImportBookSource {
  if (b.source === "cfmmc" || !!b.cfmmcUserId || /^监控中心\s/.test(b.name)) return "cfmmc"
  if (b.source === "email" || /^邮箱/.test(b.name)) return "email"
  return "upload"
}

export function isImportBookSource(v: string): v is ImportBookSource {
  return v === "upload" || v === "email" || v === "cfmmc"
}

type BooksFile = { books: ImportBook[] }

const DATA_ROOT = path.join(process.cwd(), "data", "account-risk")
const BOOKS_FILE = path.join(DATA_ROOT, "import_books.json")
const UNGROUPED_ID = "ungrouped"
const BOOK_ID_RE = /^[a-z][a-z0-9_-]{2,40}$/

function ensureRoot() {
  if (!existsSync(DATA_ROOT)) mkdirSync(DATA_ROOT, { recursive: true })
}

function readRaw(): BooksFile {
  ensureRoot()
  if (!existsSync(BOOKS_FILE)) return { books: [] }
  try {
    const parsed = JSON.parse(readFileSync(BOOKS_FILE, "utf-8")) as BooksFile
    return { books: Array.isArray(parsed.books) ? parsed.books : [] }
  } catch {
    return { books: [] }
  }
}

function writeRaw(data: BooksFile) {
  ensureRoot()
  writeFileSync(BOOKS_FILE, JSON.stringify(data, null, 2), "utf-8")
}

export function isBookId(id: string): boolean {
  return BOOK_ID_RE.test(id)
}

export function listImportBooks(): ImportBook[] {
  return readRaw().books
}

/** Drop book entries whose files were deleted from disk. */
export function pruneMissingBookFiles(importRoot: string): void {
  const data = readRaw()
  let changed = false
  for (const b of data.books) {
    const next = b.files.filter((f) => {
      const resolved = safeResolveRel(importRoot, f)
      return !!resolved && existsSync(resolved) && statSync(resolved).isFile()
    })
    if (next.length !== b.files.length) {
      b.files = next
      changed = true
    }
  }
  if (changed) writeRaw(data)
}

/** Drop empty leftover books that were never tagged as a source. */
export function pruneEmptyLegacyBooks(): void {
  const data = readRaw()
  const next = data.books.filter((b) => {
    if (b.id === UNGROUPED_ID) return true
    if (b.files.length > 0) return true
    return b.source === "upload" || b.source === "email" || b.source === "cfmmc"
  })
  if (next.length !== data.books.length) {
    data.books = next
    writeRaw(data)
  }
}

export function getImportBook(id: string): ImportBook | null {
  return listImportBooks().find((b) => b.id === id) ?? null
}

export function findImportBookByName(name: string): ImportBook | null {
  const n = name.trim()
  if (!n) return null
  return listImportBooks().find((b) => b.name === n) ?? null
}

export function findUploadBookByName(name: string): ImportBook | null {
  const n = name.trim()
  if (!n) return null
  return listImportBooks().find((b) => b.name === n && bookSource(b) === "upload") ?? null
}

function newBookId(): string {
  return `b${randomUUID().replace(/-/g, "").slice(0, 10)}`
}

export function createImportBook(name: string): ImportBook {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请填写账户名称")
  const existing = listImportBooks().find((b) => b.name === trimmed && bookSource(b) === "upload")
  if (existing) return existing
  const book: ImportBook = {
    id: newBookId(),
    name: trimmed,
    createdAt: new Date().toISOString(),
    files: [],
    source: "upload",
  }
  const data = readRaw()
  data.books.push(book)
  writeRaw(data)
  return book
}

export function createEmailImportBook(mailbox?: string): ImportBook {
  const suffix = (mailbox ?? "").trim()
  const name = suffix ? `邮箱 ${suffix}` : "邮箱获取"
  const existing = listImportBooks().find((b) => bookSource(b) === "email" && b.name === name)
  if (existing) {
    if (existing.source !== "email") {
      const data = readRaw()
      const row = data.books.find((b) => b.id === existing.id)
      if (row) {
        row.source = "email"
        writeRaw(data)
        return row
      }
    }
    return existing
  }
  const book: ImportBook = {
    id: newBookId(),
    name,
    createdAt: new Date().toISOString(),
    files: [],
    source: "email",
  }
  const data = readRaw()
  data.books.push(book)
  writeRaw(data)
  return book
}

export function getCfmmcImportBook(userId: string): ImportBook | null {
  const uid = userId.trim()
  if (!uid) return null
  return listImportBooks().find((b) => b.source === "cfmmc" && b.cfmmcUserId === uid) ?? null
}

function cfmmcBookName(userId: string, label?: string): string {
  const uid = userId.trim()
  const note = label?.trim()
  if (note && note !== "未分组" && note !== uid) return note
  return `监控中心 ${uid}`
}

export function createCfmmcImportBook(userId: string, label?: string): ImportBook {
  const uid = userId.trim()
  if (!uid) throw new Error("缺少监控中心用户名")
  const existing = getCfmmcImportBook(uid)
  if (existing) return existing
  const data = readRaw()
  const legacy = data.books.find(
    (b) =>
      b.id !== UNGROUPED_ID &&
      b.source !== "cfmmc" &&
      (b.name === uid || b.name === `监控中心 ${uid}`),
  )
  if (legacy) {
    legacy.source = "cfmmc"
    legacy.cfmmcUserId = uid
    if (legacy.name === uid) legacy.name = `监控中心 ${uid}`
    writeRaw(data)
    return legacy
  }
  const book: ImportBook = {
    id: newBookId(),
    name: cfmmcBookName(uid, label),
    createdAt: new Date().toISOString(),
    files: [],
    source: "cfmmc",
    cfmmcUserId: uid,
  }
  data.books.push(book)
  writeRaw(data)
  return book
}

/** Keep the 监控中心 book title in sync when the account 备注 changes. */
export function renameCfmmcImportBook(userId: string, label?: string): ImportBook | null {
  const uid = userId.trim()
  if (!uid) return null
  const book = getCfmmcImportBook(uid)
  if (!book) return null
  const name = cfmmcBookName(uid, label)
  if (book.name === name) return book
  const data = readRaw()
  const row = data.books.find((b) => b.id === book.id)
  if (!row) return book
  row.name = name
  writeRaw(data)
  return row
}

/** Move leftover auto-group books (named with the 资金账号) into the 监控中心 book. */
export function adoptLegacyCfmmcFiles(userId: string, officialId: string): ImportBook | null {
  const uid = userId.trim()
  const official = getImportBook(officialId)
  if (!official) return null
  const rels: string[] = []
  for (const b of listImportBooks()) {
    if (b.id === officialId || b.id === UNGROUPED_ID || bookSource(b) !== "upload") continue
    if (b.name === uid || b.name === `监控中心 ${uid}`) rels.push(...b.files)
  }
  if (rels.length === 0) return official
  return reassignFilesToExistingBook(officialId, rels)
}

export function reassignFilesToExistingBook(bookId: string, relPaths: string[]): ImportBook {
  if (!isBookId(bookId) && bookId !== UNGROUPED_ID) throw new Error("非法账户")
  const rels = relPaths.map((r) => r.replace(/\\/g, "/").replace(/^\/+/, "")).filter(Boolean)
  const names = new Set(rels.flatMap((r) => [r, path.basename(r)]))
  const data = readRaw()
  for (const b of data.books) {
    if (b.id === bookId) continue
    b.files = b.files.filter((f) => !names.has(f) && !names.has(path.basename(f)))
  }
  writeRaw(data)
  return addFilesToBook(bookId, rels)
}

/** Move file paths from 未分组 (or any book) onto a named account. Does not move files on disk. */
export function reassignFilesToBook(relPaths: string[], name: string): ImportBook {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请填写账户名称")
  if (trimmed === "未分组") throw new Error("请使用其他账户名称")
  const book = createImportBook(trimmed)
  const rels = relPaths.map((r) => r.replace(/\\/g, "/").replace(/^\/+/, "")).filter(Boolean)
  if (rels.length === 0) throw new Error("没有可命名的文件")
  const names = new Set(rels.flatMap((r) => [r, path.basename(r)]))
  const data = readRaw()
  for (const b of data.books) {
    if (b.id === book.id) continue
    b.files = b.files.filter((f) => !names.has(f) && !names.has(path.basename(f)))
  }
  writeRaw(data)
  return addFilesToBook(book.id, rels)
}

export function addFilesToBook(bookId: string, relPaths: string[]): ImportBook {
  if (!isBookId(bookId) && bookId !== UNGROUPED_ID) throw new Error("非法账户")
  const data = readRaw()
  let book = data.books.find((b) => b.id === bookId)
  if (!book) {
    book = { id: bookId, name: bookId === UNGROUPED_ID ? "未分组" : bookId, createdAt: new Date().toISOString(), files: [] }
    data.books.push(book)
  }
  const seen = new Set(book.files)
  for (const rel of relPaths) {
    const n = rel.replace(/\\/g, "/").replace(/^\/+/, "")
    if (n && !seen.has(n)) {
      book.files.push(n)
      seen.add(n)
    }
  }
  writeRaw(data)
  return book
}

export function removeFileFromBooks(relPath: string): void {
  const n = relPath.replace(/\\/g, "/")
  const data = readRaw()
  for (const book of data.books) {
    book.files = book.files.filter((f) => f !== n && path.basename(f) !== path.basename(n))
  }
  writeRaw(data)
}

export function bookDir(importRoot: string, bookId: string): string {
  const dir = path.join(importRoot, bookId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Relative spreadsheet paths under imports/ (root files + one book-id level). */
export function listSpreadsheetRelPaths(importRoot: string): string[] {
  if (!existsSync(importRoot)) return []
  const out: string[] = []
  for (const e of readdirSync(importRoot, { withFileTypes: true })) {
    if (e.isFile() && isXls(e.name)) out.push(e.name)
    if (e.isDirectory() && isBookId(e.name)) {
      const sub = path.join(importRoot, e.name)
      for (const f of readdirSync(sub, { withFileTypes: true })) {
        if (f.isFile() && isXls(f.name)) out.push(`${e.name}/${f.name}`)
      }
    }
  }
  return out.sort()
}

function isXls(name: string): boolean {
  return /\.(xls|xlsx|xlsm)$/i.test(name) && !name.startsWith("~$")
}

/** Claim root-level files as 未分组 only if they are not already in a named account. */
export function ensureUngroupedBook(importRoot: string): ImportBook | null {
  if (!existsSync(importRoot)) return null
  const claimed = new Set(
    listImportBooks()
      .filter((b) => b.id !== UNGROUPED_ID)
      .flatMap((b) => b.files.map((f) => f.replace(/\\/g, "/"))),
  )
  const rootFiles = readdirSync(importRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && isXls(e.name) && !claimed.has(e.name) && !claimed.has(`${UNGROUPED_ID}/${e.name}`))
    .map((e) => e.name)
  if (rootFiles.length === 0) return getImportBook(UNGROUPED_ID)
  return addFilesToBook(UNGROUPED_ID, rootFiles)
}

export function sourceFilesForBook(bookId: string): string[] {
  const book = getImportBook(bookId)
  if (!book) return bookId === UNGROUPED_ID ? [] : [`${bookId}/%`]
  const files = [...book.files]
  if (bookId !== UNGROUPED_ID) {
    const prefixed = `${bookId}/`
    if (!files.some((f) => f.startsWith(prefixed))) files.push(`${bookId}/%`)
  }
  return files
}

export function statRelFile(importRoot: string, rel: string): { size: number; mtime: string } | null {
  const resolved = safeResolveRel(importRoot, rel)
  if (!resolved || !existsSync(resolved) || !statSync(resolved).isFile()) return null
  const st = statSync(resolved)
  return { size: st.size, mtime: st.mtime.toISOString() }
}

export function safeResolveRel(importRoot: string, rel: string): string | null {
  const parts = rel.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..")
  if (parts.length === 0 || parts.length > 2) return null
  if (parts.length === 2 && !isBookId(parts[0]) && parts[0] !== UNGROUPED_ID) return null
  const resolved = path.resolve(importRoot, ...parts)
  const root = path.resolve(importRoot)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function isXlsName(name: string) {
  return isXls(name)
}
void isXlsName
