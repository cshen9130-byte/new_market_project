"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  ChevronsUpDown,
  CloudUpload,
  ExternalLink,
  FileSearch,
  FileText,
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
import {
  fundElementSourceKindLabel,
  isFundElementExtractableFile,
} from "@/lib/ma/fund-element-source-file"
import { needsContentBasedMaterialRename, partitionDuplicateMaterialFiles } from "@/lib/ma/investment-note-material-filename"
import type { InvestmentNote, InvestmentNoteMaterial } from "@/lib/ma/investment-notes"
import {
  INVESTMENT_NOTE_MATERIAL_MAX_BYTES,
  INVESTMENT_NOTE_MATERIAL_MAX_MB,
  autoRenameInvestmentNoteMaterials,
  deleteInvestmentNoteMaterial,
  extractInvestmentNoteMaterialElements,
  generateInvestmentNoteFromMaterials,
  investmentNoteDeepLink,
  isDdSyncedInvestmentNoteMaterial,
  linkInvestmentNoteMaterial,
  listInvestmentNoteMaterialsResult,
  listInvestmentNotes,
  openInvestmentNoteMaterial,
  uploadInvestmentNoteMaterial,
} from "@/lib/ma/investment-notes"
import {
  InvestmentNoteElementExtractPanel,
  parseExtractJob,
  type InvestmentNoteExtractJob,
} from "./InvestmentNoteElementExtractPanel"

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

function formatFileNameList(names: string[], limit = 5): string {
  const preview = names.filter(Boolean).slice(0, limit)
  if (preview.length === 0) return ""
  if (names.length > preview.length) {
    return `${preview.join("、")} 等 ${names.length} 个`
  }
  return preview.join("、")
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
          title={selected ? noteLabel(selected) : undefined}
          className={cn(
            "inline-flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded border border-zinc-200 bg-white px-2 text-left text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            buttonClassName,
          )}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-zinc-400")}>
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
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [defaultNoteId, setDefaultNoteId] = useState("")
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [panelMounted, setPanelMounted] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [extractJobs, setExtractJobs] = useState<InvestmentNoteExtractJob[]>([])
  const [extractingMaterialId, setExtractingMaterialId] = useState<string | null>(null)
  const userId = useMemo(() => currentUserId(), [])

  function rememberExtractJob(raw: unknown) {
    const job = parseExtractJob(raw)
    if (!job) return
    setExtractJobs((prev) => {
      if (prev.some((item) => item.id === job.id)) {
        return prev.map((item) => (item.id === job.id ? job : item))
      }
      return [job, ...prev]
    })
  }

  const reload = useCallback(async () => {
    try {
      const [result, teamNotes, mineNotes] = await Promise.all([
        listInvestmentNoteMaterialsResult(),
        listInvestmentNotes("team"),
        listInvestmentNotes("mine"),
      ])
      const items = result.materials
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
      if (result.dedupDeleted > 0) {
        toast({
          title: "已自动删除重复文件",
          description: `保留已关联笔记的副本，删除了 ${result.dedupDeleted} 个重复项`,
        })
      }
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

  useEffect(() => {
    setPanelMounted(true)
  }, [])

  useEffect(() => {
    if (loading) return
    const hasOpaque = materials.some(
      (item) =>
        !isDdSyncedInvestmentNoteMaterial(item) && needsContentBasedMaterialRename(item.name),
    )
    if (!hasOpaque) return
    let cancelled = false
    void (async () => {
      let renamed = 0
      for (let i = 0; i < 6; i += 1) {
        try {
          const result = await autoRenameInvestmentNoteMaterials()
          if (cancelled) return
          if (result.materials.length > 0) {
            renamed += result.materials.length
            const byId = new Map(result.materials.map((item) => [item.id, item]))
            setMaterials((prev) =>
              prev
                .filter((item) => !result.deletedIds.includes(item.id))
                .map((item) => byId.get(item.id) ?? item),
            )
          } else if (result.deletedIds.length > 0) {
            setMaterials((prev) => prev.filter((item) => !result.deletedIds.includes(item.id)))
          }
          if (result.remaining <= 0) break
        } catch {
          break
        }
      }
      if (!cancelled && renamed > 0) {
        toast({
          title: "已自动整理文件名",
          description: `已根据内容或去掉重复后缀更新 ${renamed} 个文件`,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, toast])

  const unlinkedCount = useMemo(
    () => materials.filter((m) => !m.noteId).length,
    [materials],
  )

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return materials.filter((m) => {
      if (unlinkedOnly && m.noteId) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        (m.noteTitle || "").toLowerCase().includes(q) ||
        m.uploadedByName.toLowerCase().includes(q) ||
        (m.source === "dd-table" && "尽调材料".includes(q))
      )
    })
  }, [materials, keyword, unlinkedOnly])

  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered])
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const someFilteredSelected =
    filteredIds.some((id) => selectedIds.has(id)) && !allFilteredSelected
  const selectedCount = selectedIds.size
  const selectedItems = useMemo(
    () => materials.filter((m) => selectedIds.has(m.id)),
    [materials, selectedIds],
  )

  useEffect(() => {
    if (selectedCount === 0) setPanelCollapsed(false)
  }, [selectedCount])

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    const oversized = list.filter((file) => file.size > INVESTMENT_NOTE_MATERIAL_MAX_BYTES)
    if (oversized.length > 0) {
      toast({
        title: "上传失败",
        description: `单文件不超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB：${oversized.map((f) => f.name).join("、")}`,
        variant: "destructive",
      })
      return
    }

    const { unique, duplicates: localDuplicates } = partitionDuplicateMaterialFiles(list, materials)
    const skippedNames = localDuplicates.map((file) => file.name)
    if (unique.length === 0) {
      toast({
        title: "文件已存在",
        description: `未重复上传：${formatFileNameList(skippedNames)}`,
      })
      return
    }

    setUploading(true)
    try {
      const skipReasons: string[] = []
      let extractQueued = 0
      let uploaded = 0
      for (const file of unique) {
        const result = await uploadInvestmentNoteMaterial(file, defaultNoteId || null)
        if (result.duplicate) {
          skippedNames.push(result.material.name || file.name)
          continue
        }
        uploaded += 1
        rememberExtractJob(result.extractJob)
        if (result.extractJob) extractQueued += 1
        if (result.extractSkipReason) skipReasons.push(result.extractSkipReason)
      }

      const skippedHint =
        skippedNames.length > 0 ? `；${skippedNames.length} 个重复文件已跳过：${formatFileNameList(skippedNames)}` : ""
      if (uploaded > 0) {
        toast({
          title: skippedNames.length > 0 ? "部分文件已存在" : "上传成功",
          description:
            extractQueued > 0
              ? `已上传 ${uploaded} 个文件，其中 ${extractQueued} 个识别为一页通/要素表/基金合同，正在提取产品要素${skippedHint}`
              : `已上传 ${uploaded} 个文件${skippedHint}`,
        })
      } else {
        toast({
          title: "文件已存在",
          description: `未重复上传：${formatFileNameList(skippedNames)}`,
        })
      }
      if (skipReasons.length) {
        toast({
          title: "部分文件未自动提取",
          description: skipReasons.join("；"),
        })
      }
      if (uploaded > 0) await reload()
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

  async function handleGenerateNote() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || generating) return
    if (ids.length > 8) {
      toast({
        title: "请减少所选文件",
        description: "一次最多根据 8 个文件生成笔记",
        variant: "destructive",
      })
      return
    }
    setGenerating(true)
    try {
      const result = await generateInvestmentNoteFromMaterials(ids)
      const byId = new Map(result.materials.map((m) => [m.id, m]))
      setMaterials((prev) => prev.map((m) => byId.get(m.id) ?? m))
      setSelectedIds(new Set())
      const createdTitle = result.note.title.trim() || "无标题"
      setNoteOptions((prev) => {
        if (prev.some((n) => n.id === result.note.id)) return prev
        return [{ id: result.note.id, title: createdTitle, scope: "team" as const }, ...prev]
      })
      const skippedHint =
        result.skipped.length > 0 ? `；${result.skipped.length} 个文件未能提取文字` : ""
      toast({
        title: "已生成笔记",
        description: (
          <span>
            已保存「{createdTitle}」并关联 {ids.length} 个文件{skippedHint}。{" "}
            <a
              href={investmentNoteDeepLink({
                id: result.note.id,
                title: createdTitle,
                scope: "team",
              })}
              className="underline"
            >
              查看笔记
            </a>
          </span>
        ),
      })
    } catch (err) {
      toast({
        title: "生成笔记失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setGenerating(false)
    }
  }

  function removeSelected(id: string) {
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleExtractElements(material: InvestmentNoteMaterial) {
    if (extractingMaterialId) return
    setExtractingMaterialId(material.id)
    try {
      const job = await extractInvestmentNoteMaterialElements(material.id)
      rememberExtractJob(job)
      toast({
        title: "已开始提取产品要素",
        description: material.name,
      })
    } catch (err) {
      toast({
        title: "提取失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setExtractingMaterialId(null)
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
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
          <button
            type="button"
            aria-pressed={unlinkedOnly}
            onClick={() => setUnlinkedOnly((v) => !v)}
            title="只显示尚未关联投资笔记的文件"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded border px-3 text-sm transition-colors",
              unlinkedOnly
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
            )}
          >
            未关联笔记
            {unlinkedCount > 0 ? (
              <span
                className={cn(
                  "tabular-nums",
                  unlinkedOnly ? "text-red-500" : "text-zinc-400",
                )}
              >
                {unlinkedCount}
              </span>
            ) : null}
          </button>
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
            支持 PDF / PPT / Word / Excel / 图片 / TXT / CSV / ZIP，单文件不超过 {INVESTMENT_NOTE_MATERIAL_MAX_MB}MB。上传后会自动去掉 (1)(2)、-v1 等后缀；无意义文件名会按内容重命名。识别到一页通、要素表、产品介绍、基金合同时会自动提取产品要素。
          </div>
        </button>

        <InvestmentNoteElementExtractPanel jobs={extractJobs} onJobsChange={setExtractJobs} />
      </div>

      {panelMounted && selectedCount > 0
        ? createPortal(
            panelCollapsed ? (
              <button
                type="button"
                onClick={() => setPanelCollapsed(false)}
                className="fixed bottom-6 right-6 z-[60] rounded-lg border bg-background px-4 py-2.5 text-sm font-medium shadow-lg hover:bg-muted/50 transition-colors"
              >
                {generating ? "生成中..." : `已选 (${selectedCount})`}
              </button>
            ) : (
              <div className="fixed bottom-6 right-6 z-[60] w-80 rounded-lg border bg-background shadow-xl flex flex-col max-h-[min(420px,calc(100vh-3rem))]">
                <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
                  <span className="text-sm font-medium">已选 ({selectedCount})</span>
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => setPanelCollapsed(true)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    收起
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
                  {selectedItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/50 group"
                    >
                      <span className="text-sm truncate" title={item.name}>
                        {item.name}
                      </span>
                      <button
                        type="button"
                        disabled={generating}
                        onClick={() => removeSelected(item.id)}
                        className="text-muted-foreground hover:text-foreground shrink-0 opacity-60 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                        aria-label={`移除 ${item.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0">
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => void handleGenerateNote()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {generating ? "生成中..." : "生成笔记"}
                  </button>
                </div>
              </div>
            ),
            document.body,
          )
        : null}

      <div className="min-w-0 flex-1 overflow-auto">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-400">
            {materials.length === 0
              ? "暂无上传资料"
              : unlinkedOnly
                ? "暂无未关联笔记的资料"
                : "暂无匹配资料"}
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
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
                <th className="min-w-0 px-2 py-3 font-medium">文件</th>
                <th className="w-[280px] px-4 py-3 font-medium">关联投资笔记</th>
                <th className="w-[96px] px-4 py-3 font-medium">大小</th>
                <th className="w-[112px] px-4 py-3 font-medium">上传人</th>
                <th className="w-[150px] px-4 py-3 font-medium">上传时间</th>
                <th className="w-[140px] px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((material) => {
                const syncedFromDd = isDdSyncedInvestmentNoteMaterial(material)
                const canDelete =
                  !syncedFromDd && (!material.uploadedBy || material.uploadedBy === userId)
                const checked = selectedIds.has(material.id)
                const kindLabel = fundElementSourceKindLabel(material.name)
                const canExtract = isFundElementExtractableFile({
                  name: material.name,
                  size: material.size,
                })
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
                    <td className="min-w-0 overflow-hidden px-2 py-3">
                      <div className="flex min-w-0 items-center gap-2">
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
                          title={material.name}
                          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left text-sky-600 hover:underline"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                          <span className="min-w-0 truncate">{material.name}</span>
                        </button>
                        {syncedFromDd ? (
                          <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                            尽调材料
                          </span>
                        ) : null}
                        {kindLabel ? (
                          <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">
                            {kindLabel}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="overflow-hidden px-4 py-3">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          {syncedFromDd ? (
                            <div
                              className="flex h-8 min-w-0 items-center rounded border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-700"
                              title={
                                material.noteTitle
                                  ? `${material.noteTitle}（来自尽调表格，随笔记路演关联自动同步）`
                                  : "来自尽调表格，随笔记路演关联自动同步"
                              }
                            >
                              <span className="truncate">
                                {material.noteTitle
                                  ? `${material.noteTitle}（${noteScopeFor(material.noteId) === "mine" ? "我的" : "团队"}）`
                                  : "未关联"}
                              </span>
                            </div>
                          ) : (
                            <NoteSearchPicker
                              notes={noteOptions}
                              value={material.noteId || ""}
                              onChange={(noteId) => void handleLink(material.id, noteId)}
                              placeholder="未关联"
                              clearLabel="未关联"
                              disabled={linkingId === material.id || generating}
                            />
                          )}
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
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{formatBytes(material.size)}</td>
                    <td className="truncate px-4 py-3 text-zinc-500" title={material.uploadedByName || undefined}>
                      {material.uploadedByName || "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{formatDateTime(material.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {canExtract ? (
                          <button
                            type="button"
                            disabled={extractingMaterialId === material.id}
                            onClick={() => void handleExtractElements(material)}
                            className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            title="提取产品要素"
                          >
                            {extractingMaterialId === material.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileSearch className="h-3.5 w-3.5" />
                            )}
                            提取要素
                          </button>
                        ) : null}
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
                      </div>
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
