/** IndexedDB blob store for instruction 合同 / 确认函 files (client-local demo). */

import { isEmailConfirmAttachmentId, parseEmailConfirmRecordId } from "./instructions-store"

const DB_NAME = "ma_instruction_attachments_v1"
const STORE_NAME = "files"
const DB_VERSION = 1

type StoredFile = {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
  savedAt: string
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

export async function saveInstructionAttachmentBlob(
  id: string,
  file: File,
): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const row: StoredFile = {
      id,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      blob: file,
      savedAt: new Date().toISOString(),
    }
    await idbRequest(store.put(row))
  } finally {
    db.close()
  }
}

export async function getInstructionAttachmentBlob(
  id: string,
): Promise<StoredFile | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const row = await idbRequest(store.get(id) as IDBRequest<StoredFile | undefined>)
    return row ?? null
  } finally {
    db.close()
  }
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

/** Open the stored file in a new tab (or trigger download if blocked). */
export async function openInstructionAttachment(id: string): Promise<void> {
  if (isEmailConfirmAttachmentId(id)) {
    const recordId = parseEmailConfirmRecordId(id)
    if (recordId == null) throw new Error("确认单链接无效")
    const url = `/ma/api/ops/email-confirm-records/${recordId}/file`
    const opened = window.open(url, "_blank", "noopener,noreferrer")
    if (!opened) throw new Error("无法打开确认单，请检查浏览器弹窗拦截")
    return
  }

  const row = await getInstructionAttachmentBlob(id)
  if (!row) throw new Error("附件不存在或已被清除")
  const url = URL.createObjectURL(row.blob)
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) {
    triggerBrowserDownload(url, row.name)
  }
  // Revoke after the browser has a chance to load the blob.
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

  const row = await getInstructionAttachmentBlob(id)
  if (!row) throw new Error("附件不存在或已被清除")
  const url = URL.createObjectURL(row.blob)
  triggerBrowserDownload(url, filename || row.name)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
