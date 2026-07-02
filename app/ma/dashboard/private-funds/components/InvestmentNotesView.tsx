"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
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
import type { InvestmentNote, InvestmentNoteAttachment } from "@/lib/ma/investment-notes"
import {
  associationDisplayLabel,
  createInvestmentNote,
  deleteInvestmentNote,
  listInvestmentNotes,
  setInvestmentNoteAssociations,
  setInvestmentNoteTags,
  setInvestmentNoteTeamShared,
  updateInvestmentNote,
} from "@/lib/ma/investment-notes"
import { InvestmentNoteAssociationDialog } from "./InvestmentNoteAssociationDialog"
import {
  NoteAttachmentPopover,
  NoteRichTextEditor,
  filesToAttachments,
  isRichHtmlContent,
} from "./investment-note-editor-parts"

type NotesTab = "team" | "mine"

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
}: {
  note: InvestmentNote
  onManage: () => void
}) {
  return (
    <div className="border-t border-dashed border-zinc-200 px-8 py-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <span className="text-sky-600">关联：</span>
        {note.associations.map((item) => (
          <span
            key={`${item.category}-${item.recordNo || item.name}`}
            className="inline-flex items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-500"
          >
            {associationDisplayLabel(item)}
          </span>
        ))}
        <button
          type="button"
          onClick={onManage}
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
}: {
  note: InvestmentNote
  onManageAssociations: () => void
}) {
  const isMemo = note.contentVariant === "memo"
  const isAnalysis = note.contentVariant === "analysis"
  const isPlain = note.contentVariant === "plain"

  return (
    <div key={note.id} className="flex min-h-full flex-col">
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
              className="prose prose-sm max-w-none text-sm leading-7 text-zinc-700"
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
      <NoteAssociations note={note} onManage={onManageAssociations} />
    </div>
  )
}

export function InvestmentNotesView() {
  const [activeTab, setActiveTab] = useState<NotesTab>("team")
  const [notes, setNotes] = useState<InvestmentNote[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
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
  const [draftAttachments, setDraftAttachments] = useState<InvestmentNoteAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reloadNotes = useCallback(async () => {
    try {
      const items = await listInvestmentNotes(activeTab)
      setNotes(items)
      setSelectedId((prev) => {
        if (prev && items.some((n) => n.id === prev)) return prev
        return items[0]?.id ?? null
      })
    } catch {
      setNotes([])
      setSelectedId(null)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    setLoading(true)
    void reloadNotes()
    function onRefresh() {
      void reloadNotes()
    }
    window.addEventListener("focus", onRefresh)
    document.addEventListener("visibilitychange", onRefresh)
    const timer = window.setInterval(onRefresh, 30_000)
    return () => {
      window.removeEventListener("focus", onRefresh)
      document.removeEventListener("visibilitychange", onRefresh)
      window.clearInterval(timer)
    }
  }, [reloadNotes])

  const filteredNotes = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.preview.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    )
  }, [notes, keyword])

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? filteredNotes.find((n) => n.id === selectedId) ?? null,
    [notes, filteredNotes, selectedId],
  )

  useEffect(() => {
    if (!selectedNote || editing) return
    setDraftTitle(selectedNote.title)
    setDraftContent(selectedNote.content)
    setDraftAttachments(selectedNote.attachments)
  }, [selectedNote, editing])

  const activeAttachments = editing ? draftAttachments : (selectedNote?.attachments ?? [])

  function triggerUpload() {
    fileInputRef.current?.click()
  }

  async function handleUploadFiles(files: FileList) {
    const items = filesToAttachments(files)
    const next = [...activeAttachments, ...items]
    setDraftAttachments(next)
    if (selectedNote && !editing) {
      await updateInvestmentNote(selectedNote.id, { attachments: next })
      await reloadNotes()
    }
  }

  async function handleRemoveAttachment(id: string) {
    const next = activeAttachments.filter((item) => item.id !== id)
    setDraftAttachments(next)
    if (selectedNote && !editing) {
      await updateInvestmentNote(selectedNote.id, { attachments: next })
      await reloadNotes()
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
      teamShared: activeTab === "team",
    })
    await reloadNotes()
    setSelectedId(note.id)
    setDraftTitle("无标题")
    setDraftContent("")
    setDraftAttachments([])
    setEditing(true)
  }

  function handleEdit() {
    if (!selectedNote) return
    setDraftTitle(selectedNote.title)
    setDraftContent(selectedNote.content)
    setDraftAttachments(selectedNote.attachments)
    setEditing(true)
  }

  async function handleSave() {
    if (!selectedNote) return
    await updateInvestmentNote(selectedNote.id, {
      title: draftTitle.trim() || "无标题",
      content: draftContent,
      attachments: draftAttachments,
    })
    setEditing(false)
    await reloadNotes()
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

  async function confirmAssociations(associations: InvestmentNote["associations"]) {
    if (!selectedNote) return
    await setInvestmentNoteAssociations(selectedNote.id, associations)
    setAssociationOpen(false)
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
            handleUploadFiles(e.target.files)
          }
          e.target.value = ""
        }}
      />
      <div className="flex items-center gap-0 border-b px-6 flex-shrink-0">
        {([
          { key: "team" as const, label: "团队笔记" },
          { key: "mine" as const, label: "我的笔记" },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key)
              setEditing(false)
              setSelectedId(null)
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
          </div>
          <div className="border-b px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="请输入关键字，回车搜索"
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
                            {activeTab === "mine" || !isDraftNote(note) ? note.creator : "笔记"}
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
                      className="inline-flex items-center rounded bg-red-500 px-4 py-1.5 text-sm text-white hover:bg-red-600 transition-colors"
                    >
                      保存
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleEdit}
                      className="inline-flex items-center gap-1 rounded border border-red-400 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  )}

                  <NoteAttachmentPopover
                    attachments={activeAttachments}
                    onTriggerUpload={triggerUpload}
                    onRemove={handleRemoveAttachment}
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
                  <NoteContentBody note={selectedNote} onManageAssociations={openAssociationDialog} />
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
