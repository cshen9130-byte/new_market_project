"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronsUpDown,
  CloudUpload,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
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

function noteLabel(note: NoteOption): string {
  return `${note.title}（${note.scope === "mine" ? "我的" : "团队"}）`
}

function NoteSearchPicker({
  notes,
  value,
  onChange,
  placeholder = "搜索并选择笔记",
  allowClear = true,
  clearLabel = "未关联",
  disabled = false,
  className,
  buttonClassName,
}: {
  notes: NoteOption[]
  value: string
  onChange: (noteId: string) => void
  placeholder?: string
  allowClear?: boolean
  clearLabel?: string
  disabled?: boolean
  className?: string
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = notes.find((n) => n.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded border border-zinc-200 bg-white px-2 text-left text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            buttonClassName,
          )}
        >
          <span className={cn("truncate", !selected && "text-zinc-400")}>
            {selected ? noteLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[320px] p-0", className)}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="搜索笔记标题..." />
          <CommandList>
            <CommandEmpty>未找到匹配的笔记</CommandEmpty>
            <CommandGroup>
              {allowClear ? (
                <CommandItem
                  value="__clear__ 未关联"
                  onSelect={() => {
                    onChange("")
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      !value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="text-zinc-500">{clearLabel}</span>
                </CommandItem>
              ) : null}
              {notes.map((note) => (
                <CommandItem
                  key={note.id}
                  value={`${note.title} ${note.scope === "mine" ? "我的" : "团队"} ${note.id}`}
                  onSelect={() => {
                    onChange(note.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      value === note.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{note.title}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-zinc-400">
                    {note.scope === "mine" ? "我的" : "团队"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchNoteId, setBatchNoteId] = useState("")
  const [batchLinking, setBatchLinking] = useState(false)
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
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev
        const next = new Set<string>()
        for (const id of prev) {
          if (items.some((m) => m.id === id)) next.add(id)
        }
        return next
      })
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

  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered])
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const someFilteredSelected =
    filteredIds.some((id) => selectedIds.has(id)) && !allFilteredSelected
  const selectedCount = selectedIds.size

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

  async function handleBatchLink() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!batchNoteId) {
      toast({
        title: "请先选择笔记",
        description: "搜索并选择要关联的投资笔记",
        variant: "destructive",
      })
      return
    }
    setBatchLinking(true)
    try {
      const updates = await Promise.all(
        ids.map((id) => linkInvestmentNoteMaterial(id, batchNoteId)),
      )
      const byId = new Map(updates.map((m) => [m.id, m]))
      setMaterials((prev) => prev.map((m) => byId.get(m.id) ?? m))
      setSelectedIds(new Set())
      toast({
        title: "批量关联成功",
        description: `已将 ${ids.length} 个文件关联到同一笔记`,
      })
    } catch (err) {
      toast({
        title: "批量关联失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
      await reload()
    } finally {
      setBatchLinking(false)
    }
  }

  async function handleDelete(material: InvestmentNoteMaterial) {
    if (!window.confirm(`确定删除「${material.name}」？`)) return
    try {
      await deleteInvestmentNoteMaterial(material.id)
      setMaterials((prev) => prev.filter((m) => m.id !== material.id))
      setSelectedIds((prev) => {
        if (!prev.has(material.id)) return prev
        const next = new Set(prev)
        next.delete(material.id)
        return next
      })
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

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectAllFiltered(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        for (const id of filteredIds) next.add(id)
      } else {
        for (const id of filteredIds) next.delete(id)
      }
      return next
    })
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
            <div className="min-w-[220px]">
              <NoteSearchPicker
                notes={noteOptions}
                value={defaultNoteId}
                onChange={setDefaultNoteId}
                placeholder="上传后手动关联"
                clearLabel="上传后手动关联"
                buttonClassName="h-9 text-sm"
              />
            </div>
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

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b bg-red-50/50 px-6 py-2.5">
          <span className="text-sm text-zinc-700">
            已选 <span className="font-medium text-red-600">{selectedCount}</span> 个文件
          </span>
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <span className="shrink-0 text-sm text-zinc-600">批量关联到</span>
            <NoteSearchPicker
              notes={noteOptions}
              value={batchNoteId}
              onChange={setBatchNoteId}
              placeholder="搜索要关联的笔记..."
              allowClear={false}
              disabled={batchLinking}
              buttonClassName="h-9 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={batchLinking || !batchNoteId}
            onClick={() => void handleBatchLink()}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-red-500 px-3 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {batchLinking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            关联选中
          </button>
          <button
            type="button"
            disabled={batchLinking}
            onClick={() => setSelectedIds(new Set())}
            className="inline-flex h-9 items-center gap-1 rounded border border-zinc-200 bg-white px-2.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <X className="h-3.5 w-3.5" />
            取消选择
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">暂无上传资料</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr className="border-b">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={
                      allFilteredSelected
                        ? true
                        : someFilteredSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) => toggleSelectAllFiltered(v === true)}
                    aria-label="全选当前列表"
                  />
                </th>
                <th className="px-2 py-3 font-medium">文件</th>
                <th className="px-4 py-3 font-medium w-[300px]">关联投资笔记</th>
                <th className="px-4 py-3 font-medium w-[120px]">大小</th>
                <th className="px-4 py-3 font-medium w-[140px]">上传人</th>
                <th className="px-4 py-3 font-medium w-[150px]">上传时间</th>
                <th className="px-4 py-3 font-medium w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((material) => {
                const canDelete = !material.uploadedBy || material.uploadedBy === userId
                const checked = selectedIds.has(material.id)
                return (
                  <tr
                    key={material.id}
                    className={cn(
                      "border-b border-zinc-100 hover:bg-zinc-50/70",
                      checked && "bg-red-50/40",
                    )}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleSelect(material.id, v === true)}
                        aria-label={`选择 ${material.name}`}
                      />
                    </td>
                    <td className="px-2 py-3">
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
                        <div className="min-w-0 flex-1">
                          <NoteSearchPicker
                            notes={noteOptions}
                            value={material.noteId || ""}
                            onChange={(noteId) => void handleLink(material.id, noteId)}
                            placeholder="未关联"
                            clearLabel="未关联"
                            disabled={linkingId === material.id || batchLinking}
                          />
                        </div>
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
