/** MIME type for dragging knowledge-base / 尽调资料 files into the AI assistant. */
export const MA_CHAT_DOCUMENT_MIME = "application/x-ma-chat-document"

/** Open the page AI assistant and load KB documents. */
export const MA_CHAT_OPEN_DOCUMENTS_EVENT = "ma-chat-open-documents"
/** Show the page AI assistant (handled by dashboard layout). */
export const MA_CHAT_VISIBLE_EVENT = "ma-chat-visible"

export type MaChatOpenDocumentsDetail = {
  documents: MaChatKbDocumentPayload[]
}

let pendingOpenDocuments: MaChatKbDocumentPayload[] | null = null

export function dispatchMaChatOpenDocuments(documents: MaChatKbDocumentPayload[]) {
  if (documents.length === 0) return
  pendingOpenDocuments = documents
  window.dispatchEvent(
    new CustomEvent<{ visible: boolean }>(MA_CHAT_VISIBLE_EVENT, {
      detail: { visible: true },
    }),
  )
  window.dispatchEvent(
    new CustomEvent<MaChatOpenDocumentsDetail>(MA_CHAT_OPEN_DOCUMENTS_EVENT, {
      detail: { documents },
    }),
  )
}

export function consumePendingMaChatDocuments(): MaChatKbDocumentPayload[] | null {
  const docs = pendingOpenDocuments
  pendingOpenDocuments = null
  return docs
}

export type MaChatKbDocumentPayload = {
  type: "kb-document"
  name: string
  relativePath: string
  canPreview: boolean
  extension: string
}

export type MaChatDocumentItem = {
  id: string
  name: string
  source: "local" | "kb"
  extension: string
  /** KB relative path */
  relativePath?: string
  /** Local file object URL for preview */
  objectUrl?: string
  /** Extracted text for AI context */
  textContent?: string | null
  textLoading?: boolean
  textError?: string
  canPreview?: boolean
}

/** Narrow column for staged file list + drop zone */
export const CHAT_DOC_LIST_WIDTH = 152
/** Full-height document reader / preview column (default; user-resizable) */
export const CHAT_DOC_READER_WIDTH = 400
export const CHAT_DOC_READER_MIN_WIDTH = 260
export const CHAT_DOC_READER_MAX_WIDTH = 960

export function getChatDocPanelWidth(readerWidth = CHAT_DOC_READER_WIDTH): number {
  return CHAT_DOC_LIST_WIDTH + readerWidth
}

/** @deprecated use getChatDocPanelWidth(readerWidth) */
export const CHAT_DOC_PANEL_WIDTH = getChatDocPanelWidth()
export const CHAT_DOC_MAX_TEXT_CHARS = 80_000
export const CHAT_DOC_MAX_FILE_BYTES = 15 * 1024 * 1024

const PREVIEWABLE_EXTENSIONS = new Set([
  ".pdf",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".log",
  ".tsv",
  ".xml",
])

/** PDF/HTML use inline file URLs; text types use preview=1 extraction. */
const KB_FRAME_PREVIEW_EXTENSIONS = new Set([".pdf", ".html", ".htm"])

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot).toLowerCase() : ""
}

export function canPreviewChatDocument(name: string, canPreview?: boolean): boolean {
  if (canPreview) return true
  return PREVIEWABLE_EXTENSIONS.has(getFileExtension(name))
}

export function buildKbDocumentPreviewUrl(relativePath: string, canPreview?: boolean): string {
  const fileName = relativePath.split("/").pop() ?? relativePath
  const ext = getFileExtension(fileName)
  const params = new URLSearchParams({ path: relativePath })
  if (canPreview && !KB_FRAME_PREVIEW_EXTENSIONS.has(ext)) {
    params.set("preview", "1")
  }
  return `/api/knowledge-base/file?${params.toString()}`
}

/** Centered layout when opening AI with document panel from 尽调资料. */
export function computeMaChatOpenLayout() {
  const margin = 16
  const listW = CHAT_DOC_LIST_WIDTH
  const maxH = Math.min(720, Math.round(window.innerHeight * 0.82))
  const maxTotalW = window.innerWidth - margin * 2
  let readerW = 640
  let chatW = 340
  let totalW = chatW + listW + readerW
  if (totalW > maxTotalW) {
    readerW = Math.max(CHAT_DOC_READER_MIN_WIDTH, readerW - (totalW - maxTotalW))
    totalW = chatW + listW + readerW
  }
  if (totalW > maxTotalW) {
    chatW = Math.max(300, chatW - (totalW - maxTotalW))
  }
  totalW = chatW + listW + readerW
  return {
    chatSize: { w: chatW, h: maxH },
    docReaderWidth: readerW,
    chatPos: {
      x: Math.max(margin, Math.round((window.innerWidth - totalW) / 2)),
      y: Math.max(margin, Math.round((window.innerHeight - maxH) / 2)),
    },
  }
}

export function parseMaChatKbDocumentPayload(raw: string): MaChatKbDocumentPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MaChatKbDocumentPayload
    if (parsed?.type !== "kb-document" || !parsed.relativePath || !parsed.name) return null
    return parsed
  } catch {
    return null
  }
}

export function createMaChatDocumentId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
