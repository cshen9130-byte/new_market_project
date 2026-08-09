/**
 * PostgreSQL + disk persistence for email 确认单 / 确认函 attachments.
 */

import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { query } from "@/lib/db"
import { getServerStoragePath } from "@/lib/server/storage"
import {
  parseConfirmSlipFromBuffer,
  type ParsedConfirmSlip,
} from "@/lib/server/email-confirm-parse"

export type EmailConfirmInsert = {
  crawlEmailAccount: string
  emailUid: string
  sentAt: string | null
  subject: string
  senderEmail: string
  attachmentFilename: string
  buffer: Buffer
  parsed: ParsedConfirmSlip
}

export type EmailConfirmRecord = {
  id: number
  crawl_email_account: string
  email_uid: string
  sent_at: string | null
  subject: string
  sender_email: string
  attachment_filename: string
  storage_filename: string
  file_size: number
  mime_type: string
  fund_name: string | null
  fund_code: string | null
  investor_name: string | null
  apply_date: string | null
  confirm_date: string | null
  business_type: string | null
  confirmed_amount: string | null
  confirmed_shares: string | null
  unit_nav: string | null
  trade_fee: string | null
  broker: string | null
  created_at: string
}

export type EmailConfirmMatchInput = {
  fundName?: string | null
  fundCode?: string | null
  investorName?: string | null
  amount?: string | null
  applyDate?: string | null
  confirmDate?: string | null
  /** Lookback window in days around apply/confirm date (default 14). */
  dateWindowDays?: number
  limit?: number
}

export type EmailConfirmMatchCandidate = EmailConfirmRecord & {
  score: number
  reasons: string[]
}

const SELECT_COLS = `
  id, crawl_email_account, email_uid,
  CASE WHEN sent_at IS NULL THEN NULL ELSE sent_at::text END AS sent_at,
  subject, sender_email, attachment_filename, storage_filename, file_size, mime_type,
  fund_name, fund_code, investor_name,
  CASE WHEN apply_date IS NULL THEN NULL ELSE to_char(apply_date, 'YYYY-MM-DD') END AS apply_date,
  CASE WHEN confirm_date IS NULL THEN NULL ELSE to_char(confirm_date, 'YYYY-MM-DD') END AS confirm_date,
  business_type,
  CASE WHEN confirmed_amount IS NULL THEN NULL ELSE trim(to_char(confirmed_amount, 'FM999999999999990.00')) END AS confirmed_amount,
  CASE WHEN confirmed_shares IS NULL THEN NULL ELSE trim(to_char(confirmed_shares, 'FM999999999999990.00')) END AS confirmed_shares,
  CASE WHEN unit_nav IS NULL THEN NULL ELSE trim(to_char(unit_nav, 'FM9999999990.00000000')) END AS unit_nav,
  CASE WHEN trade_fee IS NULL THEN NULL ELSE trim(to_char(trade_fee, 'FM999999999999990.00')) END AS trade_fee,
  broker, created_at::text
`

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_confirm_records (
    id                   BIGSERIAL PRIMARY KEY,
    crawl_email_account  TEXT        NOT NULL,
    email_uid            TEXT        NOT NULL,
    sent_at              TIMESTAMPTZ,
    subject              TEXT,
    sender_email         TEXT,
    attachment_filename  TEXT        NOT NULL DEFAULT '',
    storage_filename     TEXT        NOT NULL,
    file_size            INTEGER     NOT NULL DEFAULT 0,
    mime_type            TEXT        NOT NULL DEFAULT 'application/pdf',
    fund_name            TEXT,
    fund_code            TEXT,
    investor_name        TEXT,
    apply_date           DATE,
    confirm_date         DATE,
    business_type        TEXT,
    confirmed_amount     NUMERIC(18,2),
    confirmed_shares     NUMERIC(18,6),
    unit_nav             NUMERIC(16,8),
    trade_fee            NUMERIC(18,2),
    broker               TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (crawl_email_account, email_uid, attachment_filename)
  );
  CREATE INDEX IF NOT EXISTS idx_email_confirm_fund_name
    ON ops_email_confirm_records (fund_name);
  CREATE INDEX IF NOT EXISTS idx_email_confirm_fund_code
    ON ops_email_confirm_records (fund_code);
  CREATE INDEX IF NOT EXISTS idx_email_confirm_confirm_date
    ON ops_email_confirm_records (confirm_date DESC);
`

let tableEnsured = false
let ensureInFlight: Promise<void> | null = null

export async function ensureEmailConfirmTable(): Promise<void> {
  if (tableEnsured) return
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = (async () => {
    await query(CREATE_TABLE_SQL)
    tableEnsured = true
  })().finally(() => {
    ensureInFlight = null
  })
  return ensureInFlight
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() || "confirm.pdf"
}

function mimeTypeForFilename(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".xls") return "application/vnd.ms-excel"
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  return "application/octet-stream"
}

function numOrNull(value: string | null | undefined): string | null {
  if (value == null || !String(value).trim()) return null
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? String(n) : null
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, "").toLowerCase()
}

function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null
  return Math.abs(da - db) / 86_400_000
}

async function writeConfirmFile(
  crawlEmailAccount: string,
  emailUid: string,
  originalFilename: string,
  buffer: Buffer,
): Promise<{ storageFilename: string; storagePath: string }> {
  const safeAccount = sanitizeFilename(crawlEmailAccount).replace(/[@.]/g, "_")
  const ext = path.extname(originalFilename) || ".pdf"
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const storageFilename = `${emailUid}_${Date.now()}_${hash}${ext}`
  const storageDir = getServerStoragePath("email-confirms", safeAccount)
  const storagePath = path.join(storageDir, storageFilename)
  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(storagePath, buffer)
  return { storageFilename, storagePath }
}

export async function upsertEmailConfirmRecords(rows: EmailConfirmInsert[]): Promise<number> {
  if (rows.length === 0) return 0
  await ensureEmailConfirmTable()
  let saved = 0
  for (const row of rows) {
    const originalFilename = sanitizeFilename(row.attachmentFilename || "confirm.pdf")
    const { storageFilename } = await writeConfirmFile(
      row.crawlEmailAccount,
      row.emailUid,
      originalFilename,
      row.buffer,
    )
    const p = row.parsed
    const result = await query<{ id: number }>(
      `INSERT INTO ops_email_confirm_records (
         crawl_email_account, email_uid, sent_at, subject, sender_email,
         attachment_filename, storage_filename, file_size, mime_type,
         fund_name, fund_code, investor_name, apply_date, confirm_date,
         business_type, confirmed_amount, confirmed_shares, unit_nav, trade_fee, broker
       ) VALUES (
         $1, $2, $3::timestamptz, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13::date, $14::date,
         $15, $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20
       )
       ON CONFLICT (crawl_email_account, email_uid, attachment_filename)
       DO UPDATE SET
         sent_at = EXCLUDED.sent_at,
         subject = EXCLUDED.subject,
         sender_email = EXCLUDED.sender_email,
         storage_filename = EXCLUDED.storage_filename,
         file_size = EXCLUDED.file_size,
         mime_type = EXCLUDED.mime_type,
         fund_name = COALESCE(EXCLUDED.fund_name, ops_email_confirm_records.fund_name),
         fund_code = COALESCE(EXCLUDED.fund_code, ops_email_confirm_records.fund_code),
         investor_name = COALESCE(EXCLUDED.investor_name, ops_email_confirm_records.investor_name),
         apply_date = COALESCE(EXCLUDED.apply_date, ops_email_confirm_records.apply_date),
         confirm_date = COALESCE(EXCLUDED.confirm_date, ops_email_confirm_records.confirm_date),
         business_type = COALESCE(EXCLUDED.business_type, ops_email_confirm_records.business_type),
         confirmed_amount = COALESCE(EXCLUDED.confirmed_amount, ops_email_confirm_records.confirmed_amount),
         confirmed_shares = COALESCE(EXCLUDED.confirmed_shares, ops_email_confirm_records.confirmed_shares),
         unit_nav = COALESCE(EXCLUDED.unit_nav, ops_email_confirm_records.unit_nav),
         trade_fee = COALESCE(EXCLUDED.trade_fee, ops_email_confirm_records.trade_fee),
         broker = COALESCE(EXCLUDED.broker, ops_email_confirm_records.broker)
       RETURNING id`,
      [
        row.crawlEmailAccount,
        row.emailUid,
        row.sentAt,
        row.subject,
        row.senderEmail,
        originalFilename,
        storageFilename,
        row.buffer.byteLength,
        mimeTypeForFilename(originalFilename),
        p.fundName,
        p.fundCode,
        p.investorName,
        p.applyDate,
        p.confirmDate,
        p.businessType,
        numOrNull(p.confirmedAmount),
        numOrNull(p.confirmedShares),
        numOrNull(p.unitNav),
        numOrNull(p.tradeFee),
        p.broker,
      ],
    )
    if (result[0]?.id) saved += 1
  }
  return saved
}

export async function getEmailConfirmRecordById(id: number): Promise<EmailConfirmRecord | null> {
  if (!Number.isFinite(id)) return null
  await ensureEmailConfirmTable()
  const rows = await query<EmailConfirmRecord>(
    `SELECT ${SELECT_COLS} FROM ops_email_confirm_records WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

function confirmFieldsIncomplete(row: EmailConfirmRecord): boolean {
  return !(row.confirm_date || row.apply_date)
    || !row.confirmed_amount
    || !row.confirmed_shares
    || !row.unit_nav
    || !row.fund_name
    || /^(FundName|基金名称)$/i.test((row.fund_name || "").replace(/\s+/g, ""))
}

function preferText(
  next: string | null | undefined,
  prev: string | null | undefined,
): string | null {
  const n = (next || "").trim()
  if (n) return n
  const p = (prev || "").trim()
  return p || null
}

/**
 * Re-read a stored PDF and fill previously-null parsed fields (e.g. after bilingual parser fixes).
 * Does not overwrite non-null columns.
 */
export async function reparseEmailConfirmRecord(
  id: number,
): Promise<EmailConfirmRecord | null> {
  const existing = await getEmailConfirmRecordById(id)
  if (!existing) return null
  const file = await readEmailConfirmFile(existing)
  if (!file) return existing

  const parsed = await parseConfirmSlipFromBuffer(
    file.buffer,
    file.filename,
    existing.subject || "",
  )
  const prevNameBad =
    !existing.fund_name
    || /^(FundName|基金名称)$/i.test(existing.fund_name.replace(/\s+/g, ""))
  await query(
    `UPDATE ops_email_confirm_records SET
       fund_name = $2,
       fund_code = COALESCE($3, fund_code),
       investor_name = COALESCE($4, investor_name),
       apply_date = COALESCE($5::date, apply_date),
       confirm_date = COALESCE($6::date, confirm_date),
       business_type = COALESCE($7, business_type),
       confirmed_amount = COALESCE($8::numeric, confirmed_amount),
       confirmed_shares = COALESCE($9::numeric, confirmed_shares),
       unit_nav = COALESCE($10::numeric, unit_nav),
       trade_fee = COALESCE($11::numeric, trade_fee),
       broker = COALESCE($12, broker)
     WHERE id = $1`,
    [
      id,
      preferText(parsed.fundName, prevNameBad ? null : existing.fund_name),
      parsed.fundCode,
      parsed.investorName,
      parsed.applyDate,
      parsed.confirmDate,
      parsed.businessType,
      numOrNull(parsed.confirmedAmount),
      numOrNull(parsed.confirmedShares),
      numOrNull(parsed.unitNav),
      numOrNull(parsed.tradeFee),
      parsed.broker,
    ],
  )
  return getEmailConfirmRecordById(id)
}

/** Reparse incomplete candidates so the confirm dialog can auto-fill from 确认单. */
export async function enrichConfirmRecordsWithReparse(
  rows: EmailConfirmRecord[],
): Promise<EmailConfirmRecord[]> {
  const out: EmailConfirmRecord[] = []
  for (const row of rows) {
    if (!confirmFieldsIncomplete(row)) {
      out.push(row)
      continue
    }
    try {
      out.push((await reparseEmailConfirmRecord(row.id)) ?? row)
    } catch (err) {
      console.warn(`[email-confirm] reparse id=${row.id} failed`, err)
      out.push(row)
    }
  }
  return out
}

export async function readEmailConfirmFile(
  record: EmailConfirmRecord,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const safeAccount = sanitizeFilename(record.crawl_email_account).replace(/[@.]/g, "_")
  const absolutePath = getServerStoragePath(
    "email-confirms",
    safeAccount,
    record.storage_filename,
  )
  try {
    const buffer = await fs.readFile(absolutePath)
    return {
      buffer,
      filename: record.attachment_filename || record.storage_filename,
      mimeType: record.mime_type || mimeTypeForFilename(record.attachment_filename),
    }
  } catch {
    return null
  }
}

export async function listEmailConfirmRecords(options?: {
  fundName?: string
  fundCode?: string
  page?: number
  pageSize?: number
}): Promise<{ data: EmailConfirmRecord[]; total: number }> {
  await ensureEmailConfirmTable()
  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50))
  const where: string[] = []
  const params: unknown[] = []
  let i = 1
  if (options?.fundCode?.trim()) {
    where.push(`UPPER(COALESCE(fund_code,'')) = UPPER($${i++})`)
    params.push(options.fundCode.trim())
  }
  if (options?.fundName?.trim()) {
    where.push(`fund_name ILIKE $${i++}`)
    params.push(`%${options.fundName.trim()}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const totalRows = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ops_email_confirm_records ${whereSql}`,
    params,
  )
  const total = parseInt(totalRows[0]?.c ?? "0", 10) || 0
  const data = await query<EmailConfirmRecord>(
    `SELECT ${SELECT_COLS}
     FROM ops_email_confirm_records
     ${whereSql}
     ORDER BY COALESCE(confirm_date, apply_date, sent_at::date) DESC NULLS LAST, id DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  return { data, total }
}

export async function matchEmailConfirmRecords(
  input: EmailConfirmMatchInput,
): Promise<EmailConfirmMatchCandidate[]> {
  await ensureEmailConfirmTable()
  const limit = Math.min(50, Math.max(1, input.limit ?? 20))
  const windowDays = Math.max(1, input.dateWindowDays ?? 14)

  // Broad SQL prefilter, then score in JS.
  const where: string[] = []
  const params: unknown[] = []
  let i = 1
  const fundName = input.fundName?.trim()
  const fundCode = input.fundCode?.trim()
  if (fundCode) {
    where.push(`(UPPER(COALESCE(fund_code,'')) = UPPER($${i}) OR subject ILIKE $${i + 1} OR fund_name ILIKE $${i + 1})`)
    params.push(fundCode, `%${fundCode}%`)
    i += 2
  }
  if (fundName) {
    const short = fundName.slice(0, Math.min(8, fundName.length))
    where.push(`(fund_name ILIKE $${i} OR subject ILIKE $${i} OR attachment_filename ILIKE $${i})`)
    params.push(`%${short}%`)
    i += 1
  }
  // If no fund hint, still return recent confirms.
  const whereSql = where.length ? `WHERE ${where.join(" OR ")}` : ""
  const rows = await query<EmailConfirmRecord>(
    `SELECT ${SELECT_COLS}
     FROM ops_email_confirm_records
     ${whereSql}
     ORDER BY COALESCE(confirm_date, apply_date, sent_at::date) DESC NULLS LAST, id DESC
     LIMIT 200`,
    params,
  )

  // Reparse incomplete bilingual PDFs before scoring so amount/date/nav can match.
  const rowsForScore = await enrichConfirmRecordsWithReparse(rows.slice(0, 40))
  const enrichedById = new Map(rowsForScore.map((r) => [r.id, r]))
  const scoredRows = rows.map((r) => enrichedById.get(r.id) ?? r)

  const wantAmount = parseAmount(input.amount)
  const wantInvestor = normalizeName(input.investorName)
  const wantFund = normalizeName(fundName)
  const wantCode = (fundCode || "").toUpperCase()
  const wantApply = input.applyDate?.trim() || null
  const wantConfirm = input.confirmDate?.trim() || null

  const scored: EmailConfirmMatchCandidate[] = []
  for (const row of scoredRows) {
    let score = 0
    const reasons: string[] = []
    const rowFund = normalizeName(row.fund_name)
    const rowCode = (row.fund_code || "").toUpperCase()
    const rowInvestor = normalizeName(row.investor_name)
    const rowAmount = parseAmount(row.confirmed_amount)
    const subjectNorm = normalizeName(row.subject)
    const fileNorm = normalizeName(row.attachment_filename)

    if (wantCode && rowCode && wantCode === rowCode) {
      score += 40
      reasons.push("基金代码匹配")
    }
    if (wantFund) {
      const fundKey = wantFund.slice(0, Math.min(6, wantFund.length))
      if (rowFund && (rowFund.includes(wantFund) || wantFund.includes(rowFund))) {
        score += 35
        reasons.push("基金名称匹配")
      } else if (subjectNorm.includes(fundKey)) {
        score += 15
        reasons.push("主题含基金名")
      } else if (fileNorm.includes(fundKey)) {
        score += 15
        reasons.push("附件名含基金名")
      }
    }
    if (wantInvestor && rowInvestor) {
      if (rowInvestor.includes(wantInvestor) || wantInvestor.includes(rowInvestor)) {
        score += 20
        reasons.push("投资人/FOF匹配")
      }
    }
    if (wantAmount != null && rowAmount != null) {
      const diff = Math.abs(wantAmount - rowAmount)
      if (diff < 0.01) {
        score += 25
        reasons.push("金额一致")
      } else if (diff / Math.max(wantAmount, 1) < 0.001) {
        score += 15
        reasons.push("金额接近")
      }
    }
    const dApply = daysBetween(wantApply, row.apply_date)
    const dConfirm = daysBetween(wantConfirm || wantApply, row.confirm_date)
    const dBest =
      dApply != null && dConfirm != null
        ? Math.min(dApply, dConfirm)
        : (dApply ?? dConfirm)
    if (dBest != null && dBest <= windowDays) {
      score += dBest === 0 ? 20 : dBest <= 3 ? 12 : 6
      reasons.push("日期接近")
    }

    if (score <= 0) continue
    scored.push({ ...row, score, reasons })
  }

  scored.sort((a, b) => b.score - a.score || b.id - a.id)
  return scored.slice(0, limit)
}
