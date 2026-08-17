"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Combine,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Switch } from "@/components/ma/ui/switch"
import { useToast } from "@/hooks/use-toast"
import type {
  InvestmentNote,
  InvestmentNoteAttachment,
  InvestmentNoteMaterial,
} from "@/lib/ma/investment-notes"
import {
  MAX_INVESTMENT_NOTE_CONTENT_CHARS,
  associationDisplayLabel,
  buildIntegratedInvestmentNoteDraft,
  compactRichNoteHtml,
  createInvestmentNote,
  deleteInvestmentNote,
  linkInvestmentNoteMaterial,
  listInvestmentNoteMaterials,
  listInvestmentNotes,
  noteMatchesKeyword,
  openInvestmentNoteMaterial,
  proofreadInvestmentNoteWithRoadshow,
  roadshowAssociationDisplayLabel,
  selectNotesForIntegration,
  setInvestmentNoteAssociations,
  setInvestmentNoteRoadshowAssociations,
  setInvestmentNoteTags,
  setInvestmentNoteTeamShared,
  updateInvestmentNote,
  uploadInvestmentNoteMaterial,
} from "@/lib/ma/investment-notes"
import type { DueDiligenceTableRow } from "@/lib/ma/due-diligence-table"
import { loadDueDiligenceTableFromServer } from "@/lib/ma/due-diligence-table"
import type { DdMaterialsDocument, DdMaterialsFolderIndex } from "@/lib/ma/due-diligence-materials"
import {
  buildDdMaterialsFileUrl,
  buildDdMaterialsFolderIndex,
  collectDdMaterialsDocumentsForRows,
  parseRoadshowDdMaterialAttachmentId,
  roadshowDdMaterialAttachmentId,
} from "@/lib/ma/due-diligence-materials"
import { AssociatedProductHoverCard } from "./AssociatedProductHoverCard"
import { InvestmentNoteAssociationDialog } from "./InvestmentNoteAssociationDialog"
import { InvestmentNoteMaterialsView } from "./InvestmentNoteMaterialsView"
import { InvestmentNoteRoadshowAssociationDialog } from "./InvestmentNoteRoadshowAssociationDialog"
import {
  NoteAttachmentPopover,
  NoteRichTextEditor,
  isRichHtmlContent,
  type NoteAttachmentListItem,
} from "./investment-note-editor-parts"

type NotesTab = "team" | "mine" | "uploads"

function displayNoteTitle(title: string): string {
  return title.trim() || "无标题"
}

function isDraftNote(note: InvestmentNote): boolean {
  return displayNoteTitle(note.title) === "无标题" && !note.content.trim()
}

function AnalysisChart() {
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700">组合复盘分析</div>
      <div className="relative h-64 bg-[#fafafa] px-6 py-4">
        <div className="absolute left-4 top-4 bottom-10 flex flex-col justify-between text-[10px] text-zinc-400">
          <span>一日收益(万元)</span>
          <span>0</span>
          <span>-50</span>
          <span>-100</span>
        </div>
        <div className="ml-10 h-full border-l border-b border-zinc-200">
          <svg viewBox="0 0 520 180" className="h-full w-full">
            <polyline fill="none" stroke="#ef4444" strokeWidth="2" points="0,120 60,100 120,110 180,80 240,90 300,60 360,70 420,40 480,50 520,30" />
            <polyline fill="none" stroke="#3b82f6" strokeWidth="2" points="0,140 60,130 120,125 180,115 240,100 300,95 360,85 420,75 480,70 520,65" />
            <polyline fill="none" stroke="#22c55e" strokeWidth="2" points="0,150 60,145 120,140 180,135 240,130 300,125 360,120 420,115 480,110 520,105" />
          </svg>
        </div>
        <div className="ml-10 mt-1 flex justify-between text-[10px] text-zinc-400">
          <span>3000</span>
          <span>3500</span>
          <span>4000</span>
          <span>4500</span>
          <span>5000</span>
        </div>
        <div className="ml-10 mt-1 text-center text-[10px] text-zinc-400">模拟策略价格(元/吨)</div>
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-red-500" />组合30%</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-blue-500" />看跌平仓</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-green-500" />基准</span>
        </div>
      </div>
    </div>
  )
}

function NoteAssociations({
  note,
  onManage,
  onManageRoadshows,
}: {
  note: InvestmentNote
  onManage: () => void
  onManageRoadshows: () => void
}) {
  const roadshowAssociations = note.roadshowAssociations ?? []
  return (
    <div className="border-b border-dashed border-zinc-200 px-8 py-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <span className="text-sky-600">关联产品：</span>
        {note.associations.map((item) => {
          const recordNo = (item.recordNo || "").trim()
          const label = associationDisplayLabel(item)
          const className =
            "inline-flex items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-500"
          if (recordNo) {
            const chip = (
              <a
                href={`/ma/dashboard/private-funds/${encodeURIComponent(recordNo)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${className} hover:bg-red-100 hover:underline`}
                title={label}
              >
                {label}
              </a>
            )
            // Profile + NAV hover uses private-fund APIs (recordNo = beian_hao)
            if (item.category === "私募基金") {
              return (
                <AssociatedProductHoverCard
                  key={`${item.category}-${recordNo}`}
                  beian_hao={recordNo}
                  productName={item.name}
                >
                  {chip}
                </AssociatedProductHoverCard>
              )
            }
            return <span key={`${item.category}-${recordNo}`}>{chip}</span>
          }
          return (
            <span
              key={`${item.category}-${item.name}`}
              className={className}
            >
              {label}
            </span>
          )
        })}
        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center rounded border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
        >
          + 添加关联
        </button>
        <span className="mx-1 text-zinc-300">|</span>
        <span className="text-sky-600">关联路演：</span>
        {roadshowAssociations.map((item) => (
          <span
            key={item.rowId}
            className="inline-flex items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-500"
            title={item.ddDate || undefined}
          >
            {roadshowAssociationDisplayLabel(item)}
          </span>
        ))}
        <button
          type="button"
          onClick={onManageRoadshows}
          className="inline-flex items-center rounded border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
        >
          + 添加关联
        </button>
      </div>
    </div>
  )
}

function NoteContentBody({
  note,
  onManageAssociations,
  onManageRoadshowAssociations,
}: {
  note: InvestmentNote
  onManageAssociations: () => void
  onManageRoadshowAssociations: () => void
}) {
  const isMemo = note.contentVariant === "memo"
  const isAnalysis = note.contentVariant === "analysis"
  const isPlain = note.contentVariant === "plain"

  return (
    <div key={note.id} className="flex min-h-full flex-col">
      <NoteAssociations
        note={note}
        onManage={onManageAssociations}
        onManageRoadshows={onManageRoadshowAssociations}
      />
      <div className="flex-1 px-8 py-6">
        {isAnalysis && (
          <h1 className="mb-6 text-center text-lg font-semibold text-zinc-800">{displayNoteTitle(note.title)}</h1>
        )}
        {isMemo && (
          <h1 className="mb-6 text-xl font-semibold text-zinc-800">{displayNoteTitle(note.title)}</h1>
        )}
        {isAnalysis && <AnalysisChart />}
        {note.content.trim() ? (
          isRichHtmlContent(note.content) ? (
            <div
              className="investment-note-rich text-sm leading-7 text-zinc-700"
              dangerouslySetInnerHTML={{ __html: note.content }}
            />
          ) : (
            <div className="space-y-3 text-sm leading-7 text-zinc-700 whitespace-pre-wrap">
              {note.content.split("\n").map((line, index) => {
                if (/^[一二三四五六七八九十]、/.test(line)) {
                  return (
                    <p key={index} className="pt-2 font-semibold text-zinc-800">
                      {line}
                    </p>
                  )
                }
                if (/^[0-9]+\.\s/.test(line)) {
                  return (
                    <p key={index} className="font-medium text-zinc-800">
                      {line}
                    </p>
                  )
                }
                if (line === "风控报告") {
                  return (
                    <p key={index} className="font-semibold text-zinc-800">
                      {line}
                    </p>
                  )
                }
                return <p key={index}>{line || "\u00a0"}</p>
              })}
            </div>
          )
        ) : isPlain ? (
          <div className="min-h-[280px]" />
        ) : null}
      </div>
    </div>
  )
}

export function InvestmentNotesView() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const deepLinkNoteId = (searchParams.get("noteId") || "").trim()
  const deepLinkScope: "team" | "mine" =
    searchParams.get("notesScope") === "mine" ? "mine" : "team"
  const [activeTab, setActiveTab] = useState<NotesTab>(() =>
    deepLinkNoteId ? deepLinkScope : "team",
  )
  const [notes, setNotes] = useState<InvestmentNote[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => deepLinkNoteId || null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [draftTitle, setDraftTitle] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [shareOpen, setShareOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [teamSharedDraft, setTeamSharedDraft] = useState(false)
  const [tagsDraft, setTagsDraft] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameNote, setRenameNote] = useState<InvestmentNote | null>(null)
  const [renameTitleDraft, setRenameTitleDraft] = useState("")
  const [associationOpen, setAssociationOpen] = useState(false)
  const [roadshowAssociationOpen, setRoadshowAssociationOpen] = useState(false)
  const [draftAttachments, setDraftAttachments] = useState<InvestmentNoteAttachment[]>([])
  const [linkedMaterials, setLinkedMaterials] = useState<InvestmentNoteMaterial[]>([])
  const [ddRowsById, setDdRowsById] = useState<Map<string, DueDiligenceTableRow>>(new Map())
  const [materialsIndex, setMaterialsIndex] = useState<DdMaterialsFolderIndex | null>(null)
  const [loading, setLoading] = useState(true)
  const [proofreading, setProofreading] = useState(false)
  const [integrating, setIntegrating] = useState(false)
  const [uploadingAttachments, setUploadingAttachments] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingDeepLinkRef = useRef<string | null>(deepLinkNoteId || null)

  useEffect(() => {
    if (!deepLinkNoteId) return
    pendingDeepLinkRef.current = deepLinkNoteId
    setActiveTab(deepLinkScope)
    setSelectedId(deepLinkNoteId)
    setEditing(false)
  }, [deepLinkNoteId, deepLinkScope])

  const notesScope: "team" | "mine" = activeTab === "mine" ? "mine" : "team"

  const reloadNotes = useCallback(async () => {
    if (activeTab === "uploads") return
    try {
      const items = await listInvestmentNotes(notesScope)
      setNotes(items)
      setSelectedId((prev) => {
        const pending = pendingDeepLinkRef.current
        if (pending && items.some((n) => n.id === pending)) {
          pendingDeepLinkRef.current = null
          return pending
        }
        if (prev && items.some((n) => n.id === prev)) return prev
        return items[0]?.id ?? null
      })
    } catch {
      setNotes([])
      setSelectedId(null)
    } finally {
      setLoading(false)
    }
  }, [activeTab, notesScope])

  const reloadLinkedMaterials = useCallback(async (noteId: string | null) => {
    if (!noteId) {
      setLinkedMaterials([])
      return
    }
    try {
      const items = await listInvestmentNoteMaterials()
      setLinkedMaterials(items.filter((m) => m.noteId === noteId))
    } catch {
      setLinkedMaterials([])
    }
  }, [])

  useEffect(() => {
    if (activeTab === "uploads") {
      setLoading(false)
      return
    }
    setLoading(true)
    void reloadNotes()
    function onRefresh() {
      void reloadNotes()
      void reloadLinkedMaterials(selectedId)
    }
    window.addEventListener("focus", onRefresh)
    document.addEventListener("visibilitychange", onRefresh)
    const timer = window.setInterval(onRefresh, 30_000)
    return () => {
      window.removeEventListener("focus", onRefresh)
      document.removeEventListener("visibilitychange", onRefresh)
      window.clearInterval(timer)
    }
  }, [activeTab, reloadNotes, reloadLinkedMaterials, selectedId])

  useEffect(() => {
    if (activeTab === "uploads") return
    void reloadLinkedMaterials(selectedId)
  }, [activeTab, selectedId, reloadLinkedMaterials])

  const filteredNotes = useMemo(() => {
    if (!keyword.trim()) return notes
    return notes.filter((n) => noteMatchesKeyword(n, keyword))
  }, [notes, keyword])

  const mergeableNotes = useMemo(
    () => selectNotesForIntegration(filteredNotes),
    [filteredNotes],
  )

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? filteredNotes.find((n) => n.id === selectedId) ?? null,
    [notes, filteredNotes, selectedId],
  )

  const roadshowRowIds = useMemo(
    () =>
      (selectedNote?.roadshowAssociations ?? [])
        .map((item) => item.rowId?.trim())
        .filter((id): id is string => Boolean(id)),
    [selectedNote],
  )
  const hasLinkedRoadshows = roadshowRowIds.length > 0

  useEffect(() => {
    if (!hasLinkedRoadshows) return
    let cancelled = false
    void (async () => {
      try {
        const data = await loadDueDiligenceTableFromServer()
        if (cancelled) return
        setDdRowsById(new Map(data.rows.map((row) => [row.id, row])))
      } catch {
        if (!cancelled) setDdRowsById(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasLinkedRoadshows])

  useEffect(() => {
    if (!hasLinkedRoadshows) return
    let cancelled = false
    void (async () => {
      try {
        const headers: Record<string, string> = {}
        try {
          const raw = localStorage.getItem("currentUser")
          if (raw) {
            const user = JSON.parse(raw) as { id?: string }
            if (user.id?.trim()) headers["x-market-user-id"] = user.id.trim()
          }
        } catch {
          // ignore
        }
        const res = await fetch("/api/knowledge-base/tree", { headers })
        const data = await res.json()
        if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)
        if (cancelled) return
        setMaterialsIndex(buildDdMaterialsFolderIndex(data.tree ?? null))
      } catch {
        if (!cancelled) setMaterialsIndex(buildDdMaterialsFolderIndex(null))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasLinkedRoadshows])

  const roadshowMaterials = useMemo((): DdMaterialsDocument[] => {
    if (!materialsIndex || roadshowRowIds.length === 0) return []
    const rows = roadshowRowIds
      .map((id) => ddRowsById.get(id))
      .filter((row): row is DueDiligenceTableRow => Boolean(row))
    if (rows.length === 0) return []
    return collectDdMaterialsDocumentsForRows(rows, materialsIndex)
  }, [ddRowsById, materialsIndex, roadshowRowIds])

  useEffect(() => {
    if (!selectedNote || editing) return
    setDraftTitle(selectedNote.title)
    setDraftContent(selectedNote.content)
    setDraftAttachments(selectedNote.attachments)
  }, [selectedNote, editing])

  const legacyAttachments = editing
    ? draftAttachments
    : (selectedNote?.attachments ?? [])

  const activeAttachments: NoteAttachmentListItem[] = useMemo(() => {
    const roadshowItems: NoteAttachmentListItem[] = roadshowMaterials.map((doc) => ({
      id: roadshowDdMaterialAttachmentId(doc.relativePath),
      name: doc.name,
      size: doc.size,
      openable: true,
      removable: false,
      sourceLabel: "尽调材料",
    }))
    const materialItems: NoteAttachmentListItem[] = linkedMaterials.map((m) => ({
      id: m.id,
      name: m.name,
      size: m.size,
      openable: true,
    }))
    const seenIds = new Set([
      ...roadshowItems.map((m) => m.id),
      ...materialItems.map((m) => m.id),
    ])
    const seenNames = new Set(roadshowItems.map((m) => m.name.trim().toLowerCase()))
    const legacyItems: NoteAttachmentListItem[] = legacyAttachments
      .filter((a) => !seenIds.has(a.id) && !seenNames.has(a.name.trim().toLowerCase()))
      .map((a) => ({ ...a, openable: false }))
    return [...roadshowItems, ...materialItems, ...legacyItems]
  }, [linkedMaterials, legacyAttachments, roadshowMaterials])

  function triggerUpload() {
    if (!selectedNote || uploadingAttachments) return
    fileInputRef.current?.click()
  }

  async function handleUploadFiles(files: FileList) {
    if (!selectedNote || files.length === 0) return
    setUploadingAttachments(true)
    try {
      for (const file of Array.from(files)) {
        await uploadInvestmentNoteMaterial(file, selectedNote.id)
      }
      await reloadLinkedMaterials(selectedNote.id)
      toast({
        title: "上传成功",
        description: `已添加 ${files.length} 个附件`,
      })
    } catch (err) {
      toast({
        title: "上传失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setUploadingAttachments(false)
    }
  }

  async function handleRemoveAttachment(id: string) {
    if (parseRoadshowDdMaterialAttachmentId(id)) return
    const isMaterial = linkedMaterials.some((m) => m.id === id)
    if (isMaterial) {
      try {
        await linkInvestmentNoteMaterial(id, null)
        setLinkedMaterials((prev) => prev.filter((m) => m.id !== id))
      } catch (err) {
        toast({
          title: "移除失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        })
      }
      return
    }
    const next = legacyAttachments.filter((item) => item.id !== id)
    setDraftAttachments(next)
    if (selectedNote && !editing) {
      await updateInvestmentNote(selectedNote.id, { attachments: next })
      await reloadNotes()
    }
  }

  async function handleOpenAttachment(id: string) {
    const kbPath = parseRoadshowDdMaterialAttachmentId(id)
    if (kbPath) {
      const opened = window.open(buildDdMaterialsFileUrl(kbPath), "_blank", "noopener,noreferrer")
      if (!opened) {
        toast({
          title: "打开失败",
          description: "浏览器拦截了新窗口，请允许弹窗后重试",
          variant: "destructive",
        })
      }
      return
    }
    try {
      await openInvestmentNoteMaterial(id)
    } catch (err) {
      toast({
        title: "打开失败",
        description: err instanceof Error ? err.message : "无法打开文件",
        variant: "destructive",
      })
    }
  }

  function selectNote(note: InvestmentNote) {
    setSelectedId(note.id)
    setEditing(false)
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setDraftAttachments(note.attachments)
  }

  async function handleWriteNote() {
    const note = await createInvestmentNote({
      title: "无标题",
      content: "",
      teamShared: true,
    })
    await reloadNotes()
    setSelectedId(note.id)
    setDraftTitle("无标题")
    setDraftContent("")
    setDraftAttachments([])
    setTeamSharedDraft(true)
    setEditing(true)
  }

  async function handleIntegrateNotes() {
    if (integrating || saving) return
    const q = keyword.trim()
    if (!q) {
      toast({
        title: "无法整合",
        description: "请先搜索同一管理人，再整合当前列表中的多条路演笔记",
        variant: "destructive",
      })
      return
    }
    const sources = selectNotesForIntegration(filteredNotes)
    if (sources.length < 2) {
      toast({
        title: "无法整合",
        description: "当前搜索结果不足 2 条可整合笔记（空草稿和已整合笔记不会计入）",
        variant: "destructive",
      })
      return
    }

    const draft = buildIntegratedInvestmentNoteDraft(sources, q)
    if (draft.content.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
      toast({
        title: "无法整合",
        description: `合并后内容过长，请控制在 ${MAX_INVESTMENT_NOTE_CONTENT_CHARS.toLocaleString("zh-CN")} 字符以内（含格式代码，当前 ${draft.content.length.toLocaleString("zh-CN")}）`,
        variant: "destructive",
      })
      return
    }

    setIntegrating(true)
    try {
      const note = await createInvestmentNote({
        title: draft.title,
        content: draft.content,
        teamShared: notesScope === "team",
        associations: draft.associations,
        roadshowAssociations: draft.roadshowAssociations,
      })
      await reloadNotes()
      setSelectedId(note.id)
      setDraftTitle(note.title)
      setDraftContent(note.content)
      setDraftAttachments(note.attachments)
      setEditing(false)
      toast({
        title: "已整合为新笔记",
        description: `已将 ${sources.length} 条笔记合并为「${displayNoteTitle(note.title)}」，原文仍保留`,
      })
    } catch (err) {
      toast({
        title: "整合失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setIntegrating(false)
    }
  }

  function handleEdit() {
    if (!selectedNote) return
    setDraftTitle(selectedNote.title)
    setDraftContent(selectedNote.content)
    setDraftAttachments(selectedNote.attachments)
    setEditing(true)
  }

  async function handleAiProofread() {
    if (!selectedNote || proofreading || saving) return
    const rowIds = (selectedNote.roadshowAssociations ?? [])
      .map((item) => item.rowId?.trim())
      .filter(Boolean)
    if (rowIds.length === 0) {
      toast({
        title: "无法校对",
        description: "请先为该笔记关联路演",
        variant: "destructive",
      })
      return
    }

    const sourceContent = editing ? draftContent : selectedNote.content
    if (!sourceContent.trim()) {
      toast({
        title: "无法校对",
        description: "笔记内容为空",
        variant: "destructive",
      })
      return
    }

    setProofreading(true)
    try {
      const result = await proofreadInvestmentNoteWithRoadshow({
        content: sourceContent,
        rowIds,
      })
      const nextContent = compactRichNoteHtml(result.content)
      await updateInvestmentNote(selectedNote.id, { content: nextContent })
      setDraftContent(nextContent)
      await reloadNotes()

      const changeCount = result.changes.length
      toast({
        title: changeCount > 0 ? "AI 校对完成" : "AI 校对完成，未发现需修正项",
        description:
          changeCount > 0
            ? `已按关联路演修正 ${changeCount} 处基础信息${result.roadshowLabel ? `（${result.roadshowLabel}）` : ""}`
            : result.roadshowLabel
              ? `已对照路演：${result.roadshowLabel}`
              : undefined,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "请稍后重试"
      toast({
        title: "AI 校对失败",
        description: message,
        variant: "destructive",
      })
    } finally {
      setProofreading(false)
    }
  }

  async function handleSave() {
    if (!selectedNote || saving) return

    const content = compactRichNoteHtml(draftContent)
    if (content.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
      toast({
        title: "保存失败",
        description: `笔记内容过长，请控制在 ${MAX_INVESTMENT_NOTE_CONTENT_CHARS.toLocaleString("zh-CN")} 字符以内（含格式代码，当前 ${content.length.toLocaleString("zh-CN")}）`,
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      if (content !== draftContent) {
        setDraftContent(content)
      }
      await updateInvestmentNote(selectedNote.id, {
        title: draftTitle.trim() || "无标题",
        content,
        attachments: draftAttachments,
      })
      setEditing(false)
      await reloadNotes()
      toast({ title: "保存成功" })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "请稍后重试"
      toast({
        title: "保存失败",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!selectedNote) return
    void handleDeleteNote(selectedNote)
  }

  async function handleDeleteNote(note: InvestmentNote) {
    await deleteInvestmentNote(note.id)
    setEditing(false)
    if (selectedId === note.id) setSelectedId(null)
    await reloadNotes()
  }

  function openRenameDialog(note: InvestmentNote) {
    setRenameNote(note)
    setRenameTitleDraft(displayNoteTitle(note.title))
    setRenameOpen(true)
  }

  async function confirmRename() {
    if (!renameNote) return
    await updateInvestmentNote(renameNote.id, {
      title: renameTitleDraft.trim() || "无标题",
    })
    if (selectedId === renameNote.id) {
      setDraftTitle(renameTitleDraft.trim() || "无标题")
    }
    setRenameOpen(false)
    setRenameNote(null)
    await reloadNotes()
  }

  function openShareDialog() {
    if (!selectedNote) return
    setTeamSharedDraft(selectedNote.teamShared)
    setShareOpen(true)
  }

  async function confirmShare() {
    if (!selectedNote) return
    await setInvestmentNoteTeamShared(selectedNote.id, teamSharedDraft)
    setShareOpen(false)
    await reloadNotes()
  }

  function openTagsDialog() {
    if (!selectedNote) return
    setTagsDraft(selectedNote.tags.join("，"))
    setTagsOpen(true)
  }

  async function confirmTags() {
    if (!selectedNote) return
    const tags = tagsDraft
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    await setInvestmentNoteTags(selectedNote.id, tags)
    setTagsOpen(false)
    await reloadNotes()
  }

  function openAssociationDialog() {
    if (!selectedNote) return
    setAssociationOpen(true)
  }

  function openRoadshowAssociationDialog() {
    if (!selectedNote) return
    setRoadshowAssociationOpen(true)
  }

  async function confirmAssociations(associations: InvestmentNote["associations"]) {
    if (!selectedNote) return
    await setInvestmentNoteAssociations(selectedNote.id, associations)
    setAssociationOpen(false)
    await reloadNotes()
  }

  async function confirmRoadshowAssociations(
    roadshowAssociations: InvestmentNote["roadshowAssociations"],
  ) {
    if (!selectedNote) return
    await setInvestmentNoteRoadshowAssociations(selectedNote.id, roadshowAssociations)
    setRoadshowAssociationOpen(false)
    await reloadNotes()
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleUploadFiles(e.target.files)
          }
          e.target.value = ""
        }}
      />
      <div className="flex items-center gap-0 border-b px-6 flex-shrink-0">
        {([
          { key: "team" as const, label: "团队笔记" },
          { key: "mine" as const, label: "我的笔记" },
          { key: "uploads" as const, label: "上传资料" },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key)
              setEditing(false)
              if (tab.key !== "uploads") setSelectedId(null)
            }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "uploads" ? (
        <InvestmentNoteMaterialsView />
      ) : (
      <div className="flex flex-1 min-h-0">
        <aside className="flex w-[300px] shrink-0 flex-col border-r bg-white">
          <div className="border-b px-4 py-4">
            <button
              type="button"
              onClick={handleWriteNote}
              className="w-full rounded bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors"
            >
              写笔记
            </button>
            <button
              type="button"
              onClick={() => void handleIntegrateNotes()}
              disabled={integrating || !keyword.trim() || mergeableNotes.length < 2}
              title={
                !keyword.trim()
                  ? "请先搜索同一管理人的多条路演笔记"
                  : mergeableNotes.length < 2
                    ? "至少需要 2 条可整合笔记"
                    : `将当前 ${mergeableNotes.length} 条笔记整合为一条`
              }
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded border border-red-300 bg-white py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 disabled:hover:bg-white"
            >
              {integrating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Combine className="h-3.5 w-3.5" />
              )}
              {integrating
                ? "整合中..."
                : keyword.trim() && mergeableNotes.length >= 2
                  ? `整合当前 ${mergeableNotes.length} 条笔记`
                  : "整合笔记"}
            </button>
          </div>
          <div className="border-b px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索管理人 / 路演 / 产品"
                className="h-9 w-full rounded border border-zinc-200 bg-white pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="px-4 py-10 text-center text-sm text-zinc-400">加载中...</div>
            ) : filteredNotes.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-zinc-400">暂无笔记</div>
            ) : (
              filteredNotes.map((note) => {
                const active = note.id === selectedId
                return (
                  <ContextMenu key={note.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selectNote(note)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            selectNote(note)
                          }
                        }}
                        className={[
                          "group relative w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors cursor-pointer",
                          active ? "bg-sky-50/80" : "hover:bg-zinc-50",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteNote(note)
                          }}
                          className="absolute right-3 top-3 hidden rounded p-0.5 text-red-400 hover:text-red-600 group-hover:block"
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="flex items-start justify-between gap-2 pr-6">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate text-zinc-800">
                              {displayNoteTitle(note.title)}
                            </div>
                            <div className="mt-1 text-xs text-zinc-400">{note.createdDate}</div>
                          </div>
                          <span className="shrink-0 text-xs text-zinc-400 pt-0.5">
                            {notesScope === "mine" || !isDraftNote(note) ? note.creator : "笔记"}
                          </span>
                        </div>
                        {note.preview ? (
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{note.preview}</div>
                        ) : null}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-28 min-w-28">
                      <ContextMenuItem onClick={() => openRenameDialog(note)}>重命名</ContextMenuItem>
                      <ContextMenuItem variant="destructive" onClick={() => handleDeleteNote(note)}>
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })
            )}
            {filteredNotes.length > 0 && (
              <div className="px-4 py-4 text-center text-xs text-zinc-400">没有更多了</div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-white">
          {selectedNote ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="无标题"
                      className="h-10 w-full border-0 bg-transparent px-0 text-base text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
                    />
                  ) : selectedNote.contentVariant === "plain" ? (
                    <h2 className="truncate text-xl font-semibold text-zinc-800">
                      {displayNoteTitle(selectedNote.title)}
                    </h2>
                  ) : (
                    <h2 className="truncate text-sm font-medium text-zinc-800">
                      {displayNoteTitle(selectedNote.title)}
                    </h2>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {editing ? (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || proofreading}
                      className="inline-flex items-center rounded bg-red-500 px-4 py-1.5 text-sm text-white hover:bg-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "保存中..." : "保存"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleEdit}
                      disabled={proofreading}
                      className="inline-flex items-center gap-1 rounded border border-red-400 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  )}

                  {(() => {
                    const hasRoadshow = (selectedNote.roadshowAssociations?.length ?? 0) > 0
                    return (
                      <button
                        type="button"
                        onClick={() => void handleAiProofread()}
                        disabled={!hasRoadshow || proofreading || saving}
                        title={hasRoadshow ? "按关联路演校对报告基础信息" : "请先关联路演"}
                        className={[
                          "inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm transition-colors",
                          hasRoadshow
                            ? "border-violet-300 text-violet-600 hover:bg-violet-50"
                            : "border-zinc-200 text-zinc-400 cursor-not-allowed",
                          proofreading ? "opacity-70" : "",
                        ].join(" ")}
                      >
                        {proofreading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {proofreading ? "校对中..." : "AI 校对"}
                      </button>
                    )
                  })()}

                  <NoteAttachmentPopover
                    attachments={activeAttachments}
                    onTriggerUpload={triggerUpload}
                    onRemove={(id) => void handleRemoveAttachment(id)}
                    onOpen={(id) => void handleOpenAttachment(id)}
                  />

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={openShareDialog}>
                        <Share2 className="h-4 w-4" />
                        团队共享
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={openTagsDialog}>
                        <Tag className="h-4 w-4" />
                        编辑标签
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                        <Trash2 className="h-4 w-4" />
                        删除笔记
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-2 text-xs leading-5 text-zinc-400">
                        <div>创建人：{selectedNote.creator}</div>
                        <div>最近修改：{selectedNote.lastModifiedBy}</div>
                        <div>修改日期：{selectedNote.modifiedDate}</div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="flex-1 overflow-auto" key={selectedNote.id}>
                {editing ? (
                  <NoteRichTextEditor
                    value={draftContent}
                    onChange={setDraftContent}
                    onUploadAttachment={triggerUpload}
                  />
                ) : (
                  <NoteContentBody
                    note={selectedNote}
                    onManageAssociations={openAssociationDialog}
                    onManageRoadshowAssociations={openRoadshowAssociationDialog}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
              请选择笔记或点击写笔记
            </div>
          )}
        </section>
      </div>
      )}

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="text-base font-semibold">团队共享</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-zinc-800">{selectedNote?.title}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-600">团队共享：</span>
              <Switch checked={teamSharedDraft} onCheckedChange={setTeamSharedDraft} />
              <span className="text-sm text-zinc-500">{teamSharedDraft ? "共享" : "不共享"}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <button
              type="button"
              onClick={() => setShareOpen(false)}
              className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmShare}
              className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600"
            >
              确定
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tagsOpen} onOpenChange={setTagsOpen}>
        <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="text-base font-semibold">编辑标签</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5">
            <input
              type="text"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="多个标签用逗号分隔"
              className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <button
              type="button"
              onClick={() => setTagsOpen(false)}
              className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmTags}
              className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600"
            >
              确定
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <InvestmentNoteAssociationDialog
        open={associationOpen}
        onOpenChange={setAssociationOpen}
        initialAssociations={selectedNote?.associations ?? []}
        onConfirm={confirmAssociations}
      />

      <InvestmentNoteRoadshowAssociationDialog
        open={roadshowAssociationOpen}
        onOpenChange={setRoadshowAssociationOpen}
        initialAssociations={selectedNote?.roadshowAssociations ?? []}
        onConfirm={confirmRoadshowAssociations}
      />

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open)
          if (!open) setRenameNote(null)
        }}
      >
        <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="text-base font-semibold">重命名</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5">
            <input
              type="text"
              value={renameTitleDraft}
              onChange={(e) => setRenameTitleDraft(e.target.value)}
              placeholder="请输入笔记名称"
              className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmRename}
              className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600"
            >
              确定
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
