"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CloudUpload,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  Trash2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { InvestmentNote, InvestmentNoteMaterial } from "@/lib/ma/investment-notes"
import {
  deleteInvestmentNoteMaterial,
  investmentNoteDeepLink,
  linkInvestmentNoteMaterial,
  listInvestmentNoteMaterials,
  listInvestmentNotes,
  openInvestmentNoteMaterial,
  uploadInvestmentNoteMaterial,
} from "@/lib/ma/investment-notes"

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${y}/${m}/${day} ${hh}:${mm}`
}

type NoteOption = {
  id: string
  title: string
  scope: "team" | "mine"
}

function currentUserId(): string {
  if (typeof window === "undefined") return ""
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return ""
    const user = JSON.parse(raw) as { id?: string }
    return user.id?.trim() || ""
  } catch {
    return ""
  }
}

export function InvestmentNoteMaterialsView() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [materials, setMaterials] = useState<InvestmentNoteMaterial[]>([])
  const [noteOptions, setNoteOptions] = useState<NoteOption[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [defaultNoteId, setDefaultNoteId] = useState("")
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const userId = useMemo(() => currentUserId(), [])

  const reload = useCallback(async () => {
    try {
      const [items, teamNotes, mineNotes] = await Promise.all([
        listInvestmentNoteMaterials(),
        listInvestmentNotes("team"),
        listInvestmentNotes("mine"),
      ])
      setMaterials(items)
      const options: NoteOption[] = []
      const seen = new Set<string>()
      const pushNotes = (notes: InvestmentNote[], scope: "team" | "mine") => {
        for (const note of notes) {
          if (seen.has(note.id)) continue
          seen.add(note.id)
          options.push({
            id: note.id,
            title: note.title.trim() || "无标题",
            scope,
          })
        }
      }
      pushNotes(mineNotes, "mine")
      pushNotes(teamNotes, "team")
      setNoteOptions(options)
    } catch (err) {
      setMaterials([])
      toast({
        title: "加载失败",
        description: err instanceof Error ? err.message : "无法加载上传资料",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return materials
    return materials.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.noteTitle || "").toLowerCase().includes(q) ||
        m.uploadedByName.toLowerCase().includes(q),
    )
  }, [materials, keyword])

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        await uploadInvestmentNoteMaterial(file, defaultNoteId || null)
      }
      toast({
        title: "上传成功",
        description: `已上传 ${list.length} 个文件`,
      })
      await reload()
    } catch (err) {
      toast({
        title: "上传失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleLink(materialId: string, noteId: string) {
    setLinkingId(materialId)
    try {
      const updated = await linkInvestmentNoteMaterial(materialId, noteId || null)
      setMaterials((prev) => prev.map((m) => (m.id === materialId ? updated : m)))
    } catch (err) {
      toast({
        title: "关联失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setLinkingId(null)
    }
  }

  async function handleDelete(material: InvestmentNoteMaterial) {
    if (!window.confirm(`确定删除「${material.name}」？`)) return
    try {
      await deleteInvestmentNoteMaterial(material.id)
      setMaterials((prev) => prev.filter((m) => m.id !== material.id))
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }

  function noteScopeFor(noteId: string | null): "team" | "mine" {
    if (!noteId) return "team"
    return noteOptions.find((n) => n.id === noteId)?.scope ?? "team"
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-white">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files)
          e.target.value = ""
        }}
      />

      <div className="border-b px-6 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索文件名、笔记或上传人"
              className="h-9 w-full rounded border border-zinc-200 bg-white pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <span className="shrink-0">默认关联笔记</span>
            <select
              value={defaultNoteId}
              onChange={(e) => setDefaultNoteId(e.target.value)}
              className="h-9 min-w-[200px] rounded border border-zinc-200 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">上传后手动关联</option>
              {noteOptions.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}（{note.scope === "mine" ? "我的" : "团队"}）
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files)
          }}
          className={[
            "flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors",
            dragOver
              ? "border-red-400 bg-red-50/60"
              : "border-zinc-300 bg-zinc-50/80 hover:bg-zinc-100",
            uploading ? "opacity-70 cursor-wait" : "cursor-pointer",
          ].join(" ")}
        >
          {uploading ? (
            <Loader2 className="h-7 w-7 animate-spin text-red-500" />
          ) : (
            <CloudUpload className="h-7 w-7 text-zinc-400" />
          )}
          <div className="text-sm text-zinc-600">
            {uploading ? "正在上传..." : "拖拽文件到此处，或点击选择文件"}
          </div>
          <div className="text-xs text-zinc-400">
            支持 PDF / Office / 图片 / TXT / CSV / ZIP，单文件不超过 50MB
          </div>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">暂无上传资料</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr className="border-b">
                <th className="px-6 py-3 font-medium">文件</th>
                <th className="px-4 py-3 font-medium w-[280px]">关联投资笔记</th>
                <th className="px-4 py-3 font-medium w-[120px]">大小</th>
                <th className="px-4 py-3 font-medium w-[140px]">上传人</th>
                <th className="px-4 py-3 font-medium w-[150px]">上传时间</th>
                <th className="px-4 py-3 font-medium w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((material) => {
                const canDelete = !material.uploadedBy || material.uploadedBy === userId
                return (
                  <tr key={material.id} className="border-b border-zinc-100 hover:bg-zinc-50/70">
                    <td className="px-6 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          void openInvestmentNoteMaterial(material.id).catch((err) => {
                            toast({
                              title: "打开失败",
                              description: err instanceof Error ? err.message : "无法打开文件",
                              variant: "destructive",
                            })
                          })
                        }}
                        className="inline-flex max-w-full items-center gap-2 text-left text-sky-600 hover:underline"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{material.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={material.noteId || ""}
                          disabled={linkingId === material.id}
                          onChange={(e) => void handleLink(material.id, e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">未关联</option>
                          {noteOptions.map((note) => (
                            <option key={note.id} value={note.id}>
                              {note.title}（{note.scope === "mine" ? "我的" : "团队"}）
                            </option>
                          ))}
                        </select>
                        {material.noteId ? (
                          <a
                            href={investmentNoteDeepLink({
                              id: material.noteId,
                              title: material.noteTitle || "无标题",
                              scope: noteScopeFor(material.noteId),
                            })}
                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-zinc-200 text-zinc-500 hover:bg-white hover:text-sky-600"
                            title="打开关联笔记"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{formatBytes(material.size)}</td>
                    <td className="px-4 py-3 text-zinc-500">{material.uploadedByName || "-"}</td>
                    <td className="px-4 py-3 text-zinc-500">{formatDateTime(material.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(material)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
