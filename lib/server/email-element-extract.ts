/**
 * Enqueue 产品要素 extract jobs from manager 尽调材料 / 产品材料 email zips.
 * Prefers 要素表 / 一页通 over 基金合同 when both are packed together.
 */

import { createHash } from "crypto"
import AdmZip from "adm-zip"
import {
  FUND_ELEMENT_EXTRACT_EXTENSIONS,
  FUND_ELEMENT_EXTRACT_MAX_BYTES,
  isFundElementSourceFilename,
  isFundElementSourcePath,
} from "@/lib/ma/fund-element-source-file"
import { startContractExtractJob } from "@/lib/server/fund-contract-extract-job"
import {
  createElementExtractJobFromBuffer,
  findElementExtractJobsForMaterials,
} from "@/lib/server/fund-element-extract-jobs"
import { isManagerProductPackZip } from "@/lib/server/email-manager-pack"
import type { ZipSpreadsheetEntry } from "@/lib/server/email-valuation-zip"

const PREFERRED_ELEMENT_RE = /要素表|产品要素|一页通|壹页通|一期通|一页纸/

function hasExtractableExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return FUND_ELEMENT_EXTRACT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function selectFundElementZipEntries(entries: ZipSpreadsheetEntry[]): ZipSpreadsheetEntry[] {
  const sources = entries.filter((e) => {
    if (!hasExtractableExtension(e.filename)) return false
    if (e.buffer.length <= 0 || e.buffer.length > FUND_ELEMENT_EXTRACT_MAX_BYTES) return false
    return isFundElementSourcePath(e.entryName) || isFundElementSourceFilename(e.filename)
  })
  const preferred = sources.filter((e) => PREFERRED_ELEMENT_RE.test(e.entryName))
  return preferred.length > 0 ? preferred : sources
}

export function expandFundElementZipBuffer(buffer: Buffer): ZipSpreadsheetEntry[] {
  const zip = new AdmZip(buffer)
  const out: ZipSpreadsheetEntry[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const filename = entry.entryName.split(/[/\\]/).pop() ?? entry.entryName
    if (!hasExtractableExtension(filename)) continue
    if (!isFundElementSourcePath(entry.entryName) && !isFundElementSourceFilename(filename)) continue
    const data = entry.getData()
    if (!data.length || data.length > FUND_ELEMENT_EXTRACT_MAX_BYTES) continue
    out.push({
      entryName: entry.entryName,
      filename,
      buffer: data,
    })
  }
  return selectFundElementZipEntries(out)
}

export function isFundElementEmailZip(filename: string, subject = ""): boolean {
  return isManagerProductPackZip(filename, subject)
}

export type EmailElementEnqueueResult = {
  queued: number
  skipped: number
  errors: string[]
}

async function enqueueElementBuffer(input: {
  buffer: Buffer
  originalFilename: string
  uploadedBy: string
}): Promise<"queued" | "skipped"> {
  const hash = createHash("sha256").update(input.buffer).digest("hex").slice(0, 16)
  const existing = await findElementExtractJobsForMaterials({
    contentHashes: [hash],
  })
  if (existing.some((job) => job.status !== "failed")) return "skipped"
  await createElementExtractJobFromBuffer({
    buffer: input.buffer,
    originalFilename: input.originalFilename,
    uploaded_by: input.uploadedBy,
  })
  return "queued"
}

export async function enqueueElementExtractFromEmailZip(input: {
  buffer: Buffer
  archiveFilename: string
  uploadedBy: string
}): Promise<EmailElementEnqueueResult> {
  const result: EmailElementEnqueueResult = { queued: 0, skipped: 0, errors: [] }
  let entries: ZipSpreadsheetEntry[] = []
  try {
    entries = expandFundElementZipBuffer(input.buffer)
  } catch (e) {
    result.errors.push(
      `${input.archiveFilename}: ${e instanceof Error ? e.message : String(e)}`,
    )
    return result
  }

  for (const entry of entries) {
    try {
      const status = await enqueueElementBuffer({
        buffer: entry.buffer,
        originalFilename: entry.filename,
        uploadedBy: input.uploadedBy,
      })
      if (status === "queued") result.queued += 1
      else result.skipped += 1
    } catch (e) {
      result.errors.push(
        `${entry.filename}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  return result
}

export async function enqueueElementExtractFromEmailAttachment(input: {
  buffer: Buffer
  filename: string
  uploadedBy: string
}): Promise<EmailElementEnqueueResult> {
  const result: EmailElementEnqueueResult = { queued: 0, skipped: 0, errors: [] }
  if (!isFundElementSourceFilename(input.filename) || !hasExtractableExtension(input.filename)) {
    return result
  }
  if (input.buffer.length <= 0 || input.buffer.length > FUND_ELEMENT_EXTRACT_MAX_BYTES) {
    return result
  }
  try {
    const status = await enqueueElementBuffer({
      buffer: input.buffer,
      originalFilename: input.filename,
      uploadedBy: input.uploadedBy,
    })
    if (status === "queued") result.queued += 1
    else result.skipped += 1
  } catch (e) {
    result.errors.push(`${input.filename}: ${e instanceof Error ? e.message : String(e)}`)
  }
  return result
}

export function startEmailElementExtractJobs(): void {
  startContractExtractJob()
}
