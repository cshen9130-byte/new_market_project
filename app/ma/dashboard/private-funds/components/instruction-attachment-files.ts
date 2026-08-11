/**
 * Instruction 合同 / 确认函 files.
 * Server disk is the source of truth; IndexedDB is an optional local cache.
 */

import { authService } from "@/lib/auth"
import {
  isEmailConfirmAttachmentId,
  parseEmailConfirmRecordId,
} from "./instructions-store"

const DB_NAME = "ma_instruction_attachments_v1"
const STORE_NAME = "files"
const DB_VERSION = 1
const UPLOAD_API = "/ma/api/instructions/attachments"

type StoredFile = {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
  savedAt: string
}

function authHeaders(): HeadersInit {
  const uid = authService.getCurrentUser()?.id?.trim() || ""
  return uid ? { "x-market-user-id": uid } : {}
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("Failed to open attachment DB"))
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"))
  })
}

async function cacheLocalBlob(id: string, file: File | Blob, name: string): Promise<void> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const row: StoredFile = {
        id,
        name,
        type: file.type || "application/octet-stream",
        size: file.size,
        blob: file,
        savedAt: new Date().toISOString(),
      }
      await idbRequest(store.put(row))
    } finally {
      db.close()
    }
  } catch {
    // Cache is best-effort; server upload is authoritative.
  }
}

export async function getInstructionAttachmentBlob(
  id: string,
): Promise<StoredFile | null> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const row = await idbRequest(store.get(id) as IDBRequest<StoredFile | undefined>)
      return row ?? null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * Upload attachment to the shared server store (and cache locally).
 * When `id` is provided, the server stores under that id (matches instruction meta).
 */
export async function saveInstructionAttachmentBlob(
  id: string,
  file: File,
): Promise<void> {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("id", id)
  const res = await fetch(UPLOAD_API, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "附件上传失败")
  }
  await cacheLocalBlob(id, file, file.name)
}

function triggerBrowserDownload(url: string, filename?: string): void {
  const a = document.createElement("a")
  a.href = url
  if (filename) a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Open a URL in a new tab. Avoid windowFeatures — browsers treat that as a
 * popup and block it even on direct clicks. Fall back to a synthetic <a>.
 */
function openUrlInNewTab(url: string): boolean {
  const opened = window.open(url, "_blank")
  if (opened) {
    try {
      opened.opener = null
    } catch {
      /* ignore */
    }
    return true
  }
  const a = document.createElement("a")
  a.href = url
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}

function serverFileUrl(id: string, download = false): string {
  const base = `${UPLOAD_API}/${encodeURIComponent(id)}/file`
  return download ? `${base}?download=1` : base
}

async function fetchServerAttachmentBlob(
  id: string,
): Promise<{ blob: Blob; filename?: string } | null> {
  const res = await fetch(serverFileUrl(id), {
    headers: authHeaders(),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || res.statusText || "读取附件失败")
  }
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") || ""
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  const filename = match
    ? decodeURIComponent((match[1] || match[2] || "").trim())
    : undefined
  return { blob, filename }
}

/** Open the stored file in a new tab (or trigger download if blocked). */
export async function openInstructionAttachment(id: string): Promise<void> {
  if (isEmailConfirmAttachmentId(id)) {
    const recordId = parseEmailConfirmRecordId(id)
    if (recordId == null) throw new Error("确认单链接无效")
    const url = `/ma/api/ops/email-confirm-records/${recordId}/file`
    openUrlInNewTab(url)
    return
  }

  try {
    const server = await fetchServerAttachmentBlob(id)
    if (server) {
      const url = URL.createObjectURL(server.blob)
      const opened = window.open(url, "_blank")
      if (opened) {
        try {
          opened.opener = null
        } catch {
          /* ignore */
        }
      } else {
        triggerBrowserDownload(url, server.filename)
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      void cacheLocalBlob(id, server.blob, server.filename || id)
      return
    }
  } catch (e) {
    // Fall through to IndexedDB cache for offline / legacy local-only uploads.
    const local = await getInstructionAttachmentBlob(id)
    if (!local) throw e
  }

  const row = await getInstructionAttachmentBlob(id)
  if (!row) throw new Error("附件不存在或已被清除")
  const url = URL.createObjectURL(row.blob)
  const opened = window.open(url, "_blank")
  if (opened) {
    try {
      opened.opener = null
    } catch {
      /* ignore */
    }
  } else {
    triggerBrowserDownload(url, row.name)
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Force-download the stored file instead of opening a preview tab. */
export async function downloadInstructionAttachment(
  id: string,
  filename?: string,
): Promise<void> {
  if (isEmailConfirmAttachmentId(id)) {
    const recordId = parseEmailConfirmRecordId(id)
    if (recordId == null) throw new Error("确认单链接无效")
    triggerBrowserDownload(
      `/ma/api/ops/email-confirm-records/${recordId}/file?download=1`,
      filename,
    )
    return
  }

  try {
    const res = await fetch(serverFileUrl(id, true), {
      headers: authHeaders(),
    })
    if (res.status === 404) {
      // fall through
    } else if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || res.statusText || "下载附件失败")
    } else {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      triggerBrowserDownload(url, filename)
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
  } catch (e) {
    const local = await getInstructionAttachmentBlob(id)
    if (!local) throw e
  }

  const row = await getInstructionAttachmentBlob(id)
  if (!row) throw new Error("附件不存在或已被清除")
  const url = URL.createObjectURL(row.blob)
  triggerBrowserDownload(url, filename || row.name)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
