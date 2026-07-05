"use client"

import { useCallback, useRef, useState } from "react"
import {
  canPreviewChatDocument,
  CHAT_DOC_MAX_FILE_BYTES,
  createMaChatDocumentId,
  getFileExtension,
  parseMaChatKbDocumentPayload,
  type MaChatDocumentItem,
  type MaChatKbDocumentPayload,
} from "@/lib/ma/chat-documents"

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function useChatDocuments() {
  const [documents, setDocuments] = useState<MaChatDocumentItem[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const localFilesRef = useRef<Map<string, File>>(new Map())

  const loadDocumentText = useCallback(async (doc: MaChatDocumentItem) => {
    if (doc.textContent !== undefined || doc.textLoading) return

    setDocuments((prev) =>
      prev.map((item) => (item.id === doc.id ? { ...item, textLoading: true, textError: undefined } : item)),
    )

    try {
      let res: Response
      if (doc.source === "kb" && doc.relativePath) {
        res = await fetch("/ma/api/chat/document-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relativePath: doc.relativePath }),
        })
      } else if (doc.source === "local") {
        const file = localFilesRef.current.get(doc.id)
        if (!file) throw new Error("本地文件已失效，请重新添加")
        const fileBase64 = await fileToBase64(file)
        res = await fetch("/ma/api/chat/document-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileBase64, fileName: doc.name }),
        })
      } else {
        throw new Error("无法读取该文档")
      }

      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "读取失败")

      setDocuments((prev) =>
        prev.map((item) =>
          item.id === doc.id
            ? {
                ...item,
                textLoading: false,
                textContent: body.text || null,
                textError: body.text ? undefined : "未能提取文字，仍可预览文件",
              }
            : item,
        ),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取失败"
      setDocuments((prev) =>
        prev.map((item) =>
          item.id === doc.id ? { ...item, textLoading: false, textContent: null, textError: message } : item,
        ),
      )
    }
  }, [])

  const addKbDocument = useCallback((payload: MaChatKbDocumentPayload) => {
    setDocuments((prev) => {
      if (prev.some((d) => d.source === "kb" && d.relativePath === payload.relativePath)) {
        const existing = prev.find((d) => d.source === "kb" && d.relativePath === payload.relativePath)
        if (existing) setActiveDocId(existing.id)
        return prev
      }
      const doc: MaChatDocumentItem = {
        id: createMaChatDocumentId(),
        name: payload.name,
        source: "kb",
        relativePath: payload.relativePath,
        extension: payload.extension,
        canPreview: payload.canPreview,
      }
      void loadDocumentText(doc)
      setActiveDocId(doc.id)
      return [...prev, doc]
    })
  }, [loadDocumentText])

  const addLocalFile = useCallback((file: File) => {
    if (file.size > CHAT_DOC_MAX_FILE_BYTES) {
      alert(`文件 ${file.name} 超过 15MB 限制`)
      return
    }
    const extension = getFileExtension(file.name)
    const objectUrl = URL.createObjectURL(file)
    const id = createMaChatDocumentId()
    localFilesRef.current.set(id, file)
    const doc: MaChatDocumentItem = {
      id,
      name: file.name,
      source: "local",
      extension,
      objectUrl,
      canPreview: canPreviewChatDocument(file.name),
    }
    setDocuments((prev) => [...prev, doc])
    setActiveDocId(id)
    void loadDocumentText(doc)
  }, [loadDocumentText])

  const handleDataTransfer = useCallback((dataTransfer: DataTransfer): boolean => {
    const kbPayload = parseMaChatKbDocumentPayload(dataTransfer.getData("application/x-ma-chat-document"))
    if (kbPayload) {
      addKbDocument(kbPayload)
      return true
    }
    const files = dataTransfer.files
    if (files.length > 0) {
      Array.from(files).forEach(addLocalFile)
      return true
    }
    return false
  }, [addKbDocument, addLocalFile])

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => {
      const target = prev.find((d) => d.id === id)
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl)
      localFilesRef.current.delete(id)
      return prev.filter((d) => d.id !== id)
    })
    setActiveDocId((current) => (current === id ? null : current))
  }, [])

  return {
    documents,
    activeDocId,
    setActiveDocId,
    addKbDocument,
    addLocalFile,
    handleDataTransfer,
    removeDocument,
  }
}

export function getActiveDocumentContext(
  documents: MaChatDocumentItem[],
  activeDocId: string | null,
): { name: string; text: string } | null {
  if (!activeDocId) return null
  const doc = documents.find((d) => d.id === activeDocId)
  if (!doc) return null
  return { name: doc.name, text: doc.textContent ?? "" }
}
