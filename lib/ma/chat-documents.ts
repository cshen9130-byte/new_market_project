/** MIME type for dragging knowledge-base / 尽调资料 files into the AI assistant. */
export const MA_CHAT_DOCUMENT_MIME = "application/x-ma-chat-document"

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

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot).toLowerCase() : ""
}

export function canPreviewChatDocument(name: string, canPreview?: boolean): boolean {
  if (canPreview) return true
  return PREVIEWABLE_EXTENSIONS.has(getFileExtension(name))
}

export function buildKbDocumentPreviewUrl(relativePath: string, canPreview?: boolean): string {
  const params = new URLSearchParams({ path: relativePath })
  if (canPreview) params.set("preview", "1")
  return `/api/knowledge-base/file?${params.toString()}`
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
