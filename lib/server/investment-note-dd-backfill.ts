import { promises as fs } from "fs"
import {
  buildDdMaterialsFolderIndex,
  buildDdMaterialsRowPresentation,
  type DdMaterialsDocument,
} from "@/lib/ma/due-diligence-materials"
import type { DueDiligenceTableRow } from "@/lib/ma/due-diligence-table"
import {
  buildInvestmentNoteContentFromDdRow,
  buildInvestmentNoteTitleFromDdRow,
  buildProductAssociationFromDdRow,
  buildRoadshowAssociationFromDdRow,
  compactRichNoteHtml,
  MAX_INVESTMENT_NOTE_CONTENT_CHARS,
} from "@/lib/ma/investment-notes"
import { getServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import {
  composeInvestmentNoteFromFileBuffers,
  convertFileBufferToNoteHtml,
} from "@/lib/server/investment-note-generate"
import {
  collectInvestmentNoteRoadshowRowIds,
  createServerInvestmentNoteWithKbSync,
} from "@/lib/server/investment-notes"
import { getKnowledgeBaseFile, listKnowledgeBaseTree } from "@/lib/server/knowledge-base"

export const AUTO_INVESTMENT_NOTE_AUTHOR = "auto"

const MAX_GENERATE_FILES = 8
const EXTRACT_PRIORITY = [
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".html",
  ".htm",
  ".txt",
  ".csv",
]

export type DdNoteBackfillAction =
  | "skip-linked"
  | "skip-no-materials"
  | "skip-missing-files"
  | "import"
  | "generate"
  | "fail"

export type DdNoteBackfillItem = {
  rowId: string
  label: string
  action: DdNoteBackfillAction
  noteTitle?: string
  noteId?: string
  sourceFile?: string
  fileCount?: number
  error?: string
}

export type DdNoteBackfillResult = {
  dryRun: boolean
  scanned: number
  withMaterials: number
  skippedLinked: number
  skippedNoMaterials: number
  created: number
  imported: number
  generated: number
  failed: number
  items: DdNoteBackfillItem[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function rowLabel(row: DueDiligenceTableRow): string {
  return (
    buildRoadshowAssociationFromDdRow(row).label ||
    row.fundCompany ||
    row.ddTarget ||
    row.id
  )
}

function roadshowPlainTextFromRow(row: DueDiligenceTableRow): string {
  const strategy = [row.strategyLevel1, row.strategyLevel2, row.strategyLevel3]
    .map((v) => v.trim())
    .filter(Boolean)
    .join(" / ")
  const datetime = [row.ddDate.trim(), row.ddTime.trim()].filter(Boolean).join(" ")
  const fields: Array<[string, string]> = [
    ["尽调日期", datetime],
    ["尽调形式", row.ddMethod],
    ["尽调人员", row.ddPersonnel],
    ["尽调对象", row.ddTarget],
    ["基金公司", row.fundCompany],
    ["投资经理", row.investmentManager],
    ["代表产品", row.representativeProduct],
    ["备案编码", row.representativeProductBeianHao ?? ""],
    ["推荐人", row.recommender],
    ["策略初筛", row.strategyPreliminary],
    ["策略", strategy],
    ["已加入跟踪池", row.inTrackingPool],
    ["建议跟踪", row.suggestedTracking],
    ["尽调结论", row.ddConclusion],
  ]
  return fields
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}：${value.trim()}`)
    .join("\n")
}

/** Files already written as 笔记 in 尽调资料, e.g. 路演笔记.docx / xxx投资笔记.pdf. */
export function isExistingNoteMaterialName(name: string): boolean {
  const base = name.replace(/\.[^.]+$/u, "").trim()
  if (!base || /笔记本/.test(base)) return false
  return /笔记/.test(base)
}

function scoreExistingNoteFile(name: string): number {
  const base = name.replace(/\.[^.]+$/u, "")
  if (/投资笔记/.test(base)) return 100
  if (/路演笔记/.test(base)) return 90
  if (/尽调笔记/.test(base)) return 80
  if (base.endsWith("笔记")) return 70
  if (/笔记/.test(base)) return 50
  return 0
}

function pickExistingNoteDocument(documents: DdMaterialsDocument[]): DdMaterialsDocument | null {
  const matches = documents
    .filter((doc) => isExistingNoteMaterialName(doc.name))
    .sort((a, b) => scoreExistingNoteFile(b.name) - scoreExistingNoteFile(a.name))
  return matches[0] ?? null
}

function pickFilesForGeneration(documents: DdMaterialsDocument[]): DdMaterialsDocument[] {
  return [...documents]
    .sort((a, b) => {
      const pa = EXTRACT_PRIORITY.indexOf(a.extension.toLowerCase())
      const pb = EXTRACT_PRIORITY.indexOf(b.extension.toLowerCase())
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb)
    })
    .slice(0, MAX_GENERATE_FILES)
}

async function readKbFileBuffer(
  relativePath: string,
): Promise<{ buffer: Buffer; name: string } | null> {
  try {
    const file = await getKnowledgeBaseFile(relativePath)
    const buffer = await fs.readFile(file.absolutePath)
    return { buffer, name: file.name }
  } catch {
    return null
  }
}

function wrapNoteContent(input: {
  sourceHtml: string
  row: DueDiligenceTableRow
  body: string
}): string {
  const content = compactRichNoteHtml(
    `${input.sourceHtml}${buildInvestmentNoteContentFromDdRow(input.row)}${input.body}`,
  )
  if (content.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
    throw new Error("生成的笔记过长")
  }
  return content
}

function sourceBlock(message: string, skipped: string[]): string {
  const lines = [`<div><b>资料来源</b></div>`, `<div>${escapeHtml(message)}</div>`]
  if (skipped.length > 0) {
    lines.push(`<div>未能提取文字的文件：${escapeHtml(skipped.join("；"))}</div>`)
  }
  lines.push("<div><br></div>")
  return lines.join("")
}

export async function backfillInvestmentNotesFromDdMaterials(opts?: {
  dryRun?: boolean
  limit?: number
  rowId?: string
}): Promise<DdNoteBackfillResult> {
  const dryRun = Boolean(opts?.dryRun)
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : Number.POSITIVE_INFINITY
  const onlyRowId = opts?.rowId?.trim() || ""

  const snapshot = await getServerDueDiligenceTable()
  const tree = await listKnowledgeBaseTree(undefined, true)
  const index = buildDdMaterialsFolderIndex(tree)
  const linkedRowIds = collectInvestmentNoteRoadshowRowIds()

  const result: DdNoteBackfillResult = {
    dryRun,
    scanned: 0,
    withMaterials: 0,
    skippedLinked: 0,
    skippedNoMaterials: 0,
    created: 0,
    imported: 0,
    generated: 0,
    failed: 0,
    items: [],
  }

  const owner = { id: AUTO_INVESTMENT_NOTE_AUTHOR, name: AUTO_INVESTMENT_NOTE_AUTHOR }

  for (const row of snapshot.rows) {
    if (onlyRowId && row.id !== onlyRowId) continue
    result.scanned += 1

    const { documents } = buildDdMaterialsRowPresentation(row, index)
    const markedUploaded =
      documents.length > 0 ||
      row.ddMaterials.trim() === "已上传" ||
      Boolean(row.ddMaterialsKbPath?.trim())
    if (!markedUploaded) {
      result.skippedNoMaterials += 1
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action: "skip-no-materials",
      })
      continue
    }
    result.withMaterials += 1

    if (documents.length === 0) {
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action: dryRun ? "skip-missing-files" : "fail",
        error: `尽调资料文件夹为空或不存在：${row.ddMaterialsKbPath || "(无路径)"}`,
      })
      if (!dryRun) result.failed += 1
      continue
    }

    if (linkedRowIds.has(row.id)) {
      result.skippedLinked += 1
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action: "skip-linked",
        fileCount: documents.length,
      })
      continue
    }

    if (result.created + result.failed >= limit) continue

    const existingNoteDoc = pickExistingNoteDocument(documents)
    const action: Exclude<DdNoteBackfillAction, "skip-linked" | "skip-no-materials" | "fail"> =
      existingNoteDoc ? "import" : "generate"
    const fallbackTitle = buildInvestmentNoteTitleFromDdRow(row)
    const product = buildProductAssociationFromDdRow(row)
    const roadshowAssociations = [buildRoadshowAssociationFromDdRow(row)]

    if (dryRun) {
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action,
        noteTitle: existingNoteDoc
          ? existingNoteDoc.name.replace(/\.[^.]+$/u, "")
          : fallbackTitle,
        sourceFile: existingNoteDoc?.name,
        fileCount: documents.length,
      })
      result.created += 1
      if (action === "import") result.imported += 1
      else result.generated += 1
      continue
    }

    try {
      let title = fallbackTitle
      let body = ""
      let sourceHtml = ""
      let sourceFile: string | undefined

      if (existingNoteDoc) {
        const file = await readKbFileBuffer(existingNoteDoc.relativePath)
        if (!file) throw new Error(`无法读取尽调资料：${existingNoteDoc.name}`)
        body = await convertFileBufferToNoteHtml(file.buffer, file.name)
        if (!body.replace(/<[^>]+>/g, "").trim()) {
          throw new Error(`尽调资料「${existingNoteDoc.name}」没有可用文字`)
        }
        const fileTitle = existingNoteDoc.name.replace(/\.[^.]+$/u, "").trim()
        if (fileTitle && fileTitle !== "笔记") title = fileTitle
        sourceFile = existingNoteDoc.name
        sourceHtml = sourceBlock(`本笔记内容来自尽调资料「${existingNoteDoc.name}」`, [])
      } else {
        const picked = pickFilesForGeneration(documents)
        const files: Array<{ name: string; buffer: Buffer }> = []
        const missing: string[] = []
        for (const doc of picked) {
          const file = await readKbFileBuffer(doc.relativePath)
          if (!file) {
            missing.push(`${doc.name}（文件缺失）`)
            continue
          }
          files.push(file)
        }
        const composed = await composeInvestmentNoteFromFileBuffers({
          files,
          roadshowPlainText: roadshowPlainTextFromRow(row),
          fallbackTitle,
        })
        title = composed.title || fallbackTitle
        body = composed.body
        sourceFile = composed.extractedNames[0]
        const skipped = [...missing, ...composed.skipped]
        if (composed.extractedNames.length > 0) {
          sourceHtml = sourceBlock(
            `本笔记根据 ${composed.extractedNames.length} 份尽调资料及路演信息自动生成：${composed.extractedNames.join("、")}`,
            skipped,
          )
        } else {
          sourceHtml = sourceBlock("本笔记根据路演信息自动生成（尽调资料未能提取文字）", skipped)
        }
      }

      const content = wrapNoteContent({ sourceHtml, row, body })
      const note = await createServerInvestmentNoteWithKbSync(
        AUTO_INVESTMENT_NOTE_AUTHOR,
        AUTO_INVESTMENT_NOTE_AUTHOR,
        owner,
        {
          title,
          content,
          teamShared: true,
          roadshowAssociations,
          associations: product ? [product] : [],
        },
        { append: true },
      )

      linkedRowIds.add(row.id)
      result.created += 1
      if (action === "import") result.imported += 1
      else result.generated += 1
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action,
        noteTitle: note.title,
        noteId: note.id,
        sourceFile,
        fileCount: documents.length,
      })
    } catch (err) {
      result.failed += 1
      result.items.push({
        rowId: row.id,
        label: rowLabel(row),
        action: "fail",
        sourceFile: existingNoteDoc?.name,
        fileCount: documents.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
