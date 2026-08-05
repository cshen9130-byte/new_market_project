/**
 * Extract 融航结算单 workbooks from .zip or .rar archives.
 */

import AdmZip from "adm-zip"
import { createExtractorFromData } from "node-unrar-js"

import { isRonghangSettlementFilename } from "@/lib/server/ronghang-settlement-parse"

export type RonghangArchiveKind = "zip" | "rar"

export type RonghangArchiveEntry = {
  /** Basename only, e.g. 0170809215890_2026-05-20.xls */
  name: string
  data: Buffer
}

const RAR_MAGIC = Buffer.from([0x52, 0x61, 0x72, 0x21]) // Rar!

export function isRonghangArchiveFilename(name: string): boolean {
  const base = (name || "").trim().replace(/\\/g, "/")
  const leaf = base.includes("/") ? base.slice(base.lastIndexOf("/") + 1) : base
  if (/\.(zip|rar)$/i.test(leaf)) return true
  return false
}

export function detectRonghangArchiveKind(buffer: Buffer, fileName = ""): RonghangArchiveKind {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(RAR_MAGIC)) return "rar"
  // ZIP local file header / empty archive
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip"
  if (/\.rar$/i.test(fileName)) return "rar"
  return "zip"
}

function entryBaseName(entryName: string): string {
  return entryName.split(/[/\\]/).pop() || entryName
}

function extractFromZip(buffer: Buffer): RonghangArchiveEntry[] {
  const zip = new AdmZip(buffer)
  const out: RonghangArchiveEntry[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = entryBaseName(entry.entryName)
    if (!isRonghangSettlementFilename(name)) continue
    out.push({ name, data: entry.getData() })
  }
  return out
}

async function extractFromRar(buffer: Buffer): Promise<RonghangArchiveEntry[]> {
  // Copy into a standalone ArrayBuffer — Node Buffer may be a view into a larger pool
  const data = Uint8Array.from(buffer).buffer
  const extractor = await createExtractorFromData({ data })
  const extracted = extractor.extract({
    files: (header) =>
      !header.flags.directory && isRonghangSettlementFilename(entryBaseName(header.name)),
  })

  const out: RonghangArchiveEntry[] = []
  for (const file of extracted.files) {
    if (!file.extraction) continue
    out.push({
      name: entryBaseName(file.fileHeader.name),
      data: Buffer.from(file.extraction),
    })
  }
  return out
}

/** List settlement Excel files inside a zip/rar buffer. */
export async function extractRonghangArchiveEntries(
  buffer: Buffer,
  sourceFileName = "",
): Promise<{ kind: RonghangArchiveKind; entries: RonghangArchiveEntry[] }> {
  const kind = detectRonghangArchiveKind(buffer, sourceFileName)
  const entries = kind === "rar" ? await extractFromRar(buffer) : extractFromZip(buffer)
  if (entries.length === 0) {
    throw new Error(
      `${kind.toUpperCase()} 中未找到 .xls / .xlsx 结算单文件。请确认压缩包内为融航/国金交易结算日报。`,
    )
  }
  return { kind, entries }
}

/** Repack extracted settlement files into a ZIP buffer (for Python report CLI). */
export function packRonghangEntriesToZip(entries: RonghangArchiveEntry[]): Buffer {
  const zip = new AdmZip()
  for (const entry of entries) {
    zip.addFile(entry.name, entry.data)
  }
  return zip.toBuffer()
}

/** Ensure the buffer passed to Python is always a real ZIP. */
export async function ensureRonghangZipBuffer(
  buffer: Buffer,
  sourceFileName = "",
): Promise<{ zipBuffer: Buffer; kind: RonghangArchiveKind }> {
  const kind = detectRonghangArchiveKind(buffer, sourceFileName)
  if (kind === "zip") {
    return { zipBuffer: buffer, kind }
  }
  const { entries } = await extractRonghangArchiveEntries(buffer, sourceFileName)
  return { zipBuffer: packRonghangEntriesToZip(entries), kind }
}
