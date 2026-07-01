"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronsUpDown,
  CopyCheck,
  FileText,
  Filter,
  Inbox,
  Lock,
  Pencil,
  Search,
  Share2,
  Trash2,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DueDiligenceReport } from "@/lib/ma/due-diligence-reports"
import {
  deleteDueDiligenceReport,
  dueDiligenceReportEditorUrl,
  listPublishedDueDiligenceReports,
} from "@/lib/ma/due-diligence-reports"
import type { DueDiligenceQuestionnaire } from "@/lib/ma/due-diligence-questionnaires"
import { listDueDiligenceQuestionnaires } from "@/lib/ma/due-diligence-questionnaires"
import { DueDiligenceReportAuditDialog } from "./DueDiligenceReportAuditDialog"
import { DueDiligenceReportShareDialog } from "./DueDiligenceReportShareDialog"
import { NewDueDiligenceQuestionnaireDialog } from "./NewDueDiligenceQuestionnaireDialog"
import { NewDueDiligenceReportDialog } from "./NewDueDiligenceReportDialog"

type ReportTab = "report" | "questionnaire"

const thBase = "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800`
const tdBase = "px-3 py-3 border-b border-zinc-100 align-middle"

function SortableHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {label}
      <ChevronsUpDown className="h-3 w-3 opacity-40" />
    </span>
  )
}

function FilterableHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {label}
      <Filter className="h-3 w-3 opacity-40" />
    </span>
  )
}

const REPORT_COLUMNS = [
  { key: "index", label: "序号", width: "w-16 text-center" },
  { key: "name", label: "报告名称" },
  { key: "manager", label: "受托管理人", filter: true },
  { key: "ddDate", label: "尽调日期", sort: true },
  { key: "ddPerson", label: "尽调人", filter: true },
  { key: "reviewer", label: "审核人", filter: true },
  { key: "reviewStatus", label: "审核状态", filter: true },
  { key: "modifiedDate", label: "修改日期", sort: true },
  { key: "creator", label: "创建人", filter: true },
  { key: "createdDate", label: "创建日期", sort: true },
  { key: "actions", label: "操作", width: "w-28 text-center" },
] as const

const QUESTIONNAIRE_COLUMNS = [
  { key: "index", label: "序号", width: "w-16 text-center" },
  { key: "name", label: "报告名称" },
  { key: "manager", label: "关联管理人", filter: true },
  { key: "ddDate", label: "问卷日期", sort: true },
  { key: "createdDate", label: "创建日期", sort: true },
  { key: "status", label: "报告状态", filter: true },
  { key: "submitter", label: "提交人" },
  { key: "actions", label: "操作", width: "w-20 text-center" },
] as const

export function DueDiligenceReportView() {
  const [activeTab, setActiveTab] = useState<ReportTab>("report")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [newReportOpen, setNewReportOpen] = useState(false)
  const [newQuestionnaireOpen, setNewQuestionnaireOpen] = useState(false)
  const [editQuestionnaire, setEditQuestionnaire] = useState<DueDiligenceQuestionnaire | null>(null)
  const [reports, setReports] = useState<DueDiligenceReport[]>([])
  const [questionnaires, setQuestionnaires] = useState<DueDiligenceQuestionnaire[]>([])
  const [shareReport, setShareReport] = useState<DueDiligenceReport | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [auditReport, setAuditReport] = useState<DueDiligenceReport | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)

  const reloadReports = useCallback(() => {
    setReports(listPublishedDueDiligenceReports())
  }, [])

  const reloadQuestionnaires = useCallback(() => {
    setQuestionnaires(listDueDiligenceQuestionnaires())
  }, [])

  useEffect(() => {
    reloadReports()
    reloadQuestionnaires()
    function onStorage(e: StorageEvent) {
      if (e.key === "dd_diligence_reports") reloadReports()
      if (e.key === "dd_diligence_questionnaires") reloadQuestionnaires()
    }
    function onFocus() {
      reloadReports()
      reloadQuestionnaires()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("focus", onFocus)
    }
  }, [reloadReports, reloadQuestionnaires])

  const columns = activeTab === "report" ? REPORT_COLUMNS : QUESTIONNAIRE_COLUMNS

  const filteredReports = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return reports
    return reports.filter((r) => r.title.toLowerCase().includes(q))
  }, [reports, keyword])

  const filteredQuestionnaires = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return questionnaires
    return questionnaires.filter((item) => item.title.toLowerCase().includes(q))
  }, [questionnaires, keyword])

  const activeItems = activeTab === "report" ? filteredReports : filteredQuestionnaires
  const total = activeItems.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageReports = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredReports.slice(start, start + pageSize)
  }, [filteredReports, page, pageSize])

  const pageQuestionnaires = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredQuestionnaires.slice(start, start + pageSize)
  }, [filteredQuestionnaires, page, pageSize])

  const searchPlaceholder = useMemo(
    () => (activeTab === "report" ? "请输入报告名称搜索" : "输入报告名称并搜索"),
    [activeTab],
  )

  const footerNote = useMemo(
    () =>
      activeTab === "report"
        ? "说明：线上/线下尽调后，填写尽调报告，团队内共享。"
        : "说明：新建报告后，复制链接发送给尽调对象填写，提交后团队内共享。",
    [activeTab],
  )

  function handleDelete(id: string) {
    deleteDueDiligenceReport(id)
    reloadReports()
  }

  function openShareDialog(report: DueDiligenceReport) {
    setShareReport(report)
    setShareOpen(true)
  }

  function openAuditDialog(report: DueDiligenceReport) {
    setAuditReport(report)
    setAuditOpen(true)
  }

  function handleEditQuestionnaire(item: DueDiligenceQuestionnaire) {
    setEditQuestionnaire(item)
    setNewQuestionnaireOpen(true)
  }

  function handleNewButtonClick() {
    if (activeTab === "report") {
      setNewReportOpen(true)
      return
    }
    setEditQuestionnaire(null)
    setNewQuestionnaireOpen(true)
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 px-6 py-5">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {([
          { key: "report" as const, label: "尽调报告" },
          { key: "questionnaire" as const, label: "尽调问卷" },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key)
              setPage(1)
              setKeyword("")
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
          {activeTab === "report" && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-zinc-600">管理人标签</span>
              <span className="inline-flex items-center rounded border border-red-400 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-500">
                不限
              </span>
            </div>
          )}
          <div className={`relative flex-1 min-w-[220px] ${activeTab === "report" ? "max-w-md" : "max-w-xl"}`}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value)
                setPage(1)
              }}
              placeholder={searchPlaceholder}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewButtonClick}
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors shrink-0"
        >
          新建报告
        </button>
      </div>

      <NewDueDiligenceReportDialog open={newReportOpen} onOpenChange={setNewReportOpen} />
      <NewDueDiligenceQuestionnaireDialog
        open={newQuestionnaireOpen}
        onOpenChange={(open) => {
          setNewQuestionnaireOpen(open)
          if (!open) setEditQuestionnaire(null)
        }}
        questionnaire={editQuestionnaire}
        onSaved={reloadQuestionnaires}
      />
      <DueDiligenceReportShareDialog
        report={shareReport}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onSaved={reloadReports}
      />
      <DueDiligenceReportAuditDialog
        report={auditReport}
        open={auditOpen}
        onOpenChange={setAuditOpen}
        onSaved={reloadReports}
      />

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={[
                      "sort" in col && col.sort ? thSort : thBase,
                      col.width ?? "",
                    ].join(" ")}
                  >
                    {"sort" in col && col.sort ? (
                      <SortableHeader label={col.label} />
                    ) : "filter" in col && col.filter ? (
                      <FilterableHeader label={col.label} />
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeTab === "report" && pageReports.length > 0 ? (
                pageReports.map((row, index) => (
                  <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                    <td className={`${tdBase} text-center text-zinc-500`}>
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className={tdBase}>
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                        <button type="button" className="text-sky-600 hover:underline truncate max-w-[180px]">
                          {row.title}
                        </button>
                      </span>
                    </td>
                    <td className={tdBase}>{row.company || "—"}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.ddDate}</td>
                    <td className={tdBase}>{row.ddPerson}</td>
                    <td className={tdBase}>{row.reviewer}</td>
                    <td className={tdBase}>
                      <span className="text-orange-500">{row.reviewStatus}</span>
                    </td>
                    <td className={`${tdBase} tabular-nums`}>{row.modifiedDate}</td>
                    <td className={tdBase}>{row.creator}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.createdDate}</td>
                    <td className={tdBase}>
                      <div className="flex items-center justify-center gap-2 text-zinc-400">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => openShareDialog(row)}
                              className="hover:text-zinc-700 transition-colors"
                              aria-label="共享"
                            >
                              <Share2 className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>共享</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => window.open(dueDiligenceReportEditorUrl(row.templateId, row.id), "_blank", "noopener,noreferrer")}
                              className="hover:text-zinc-700 transition-colors"
                              aria-label="编辑"
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>编辑</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => openAuditDialog(row)}
                              className="hover:text-zinc-700 transition-colors"
                              aria-label="审核设置"
                            >
                              <CopyCheck className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>审核设置</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleDelete(row.id)}
                              className="hover:text-red-600 transition-colors"
                              aria-label="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>删除</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              ) : activeTab === "questionnaire" && pageQuestionnaires.length > 0 ? (
                pageQuestionnaires.map((row, index) => (
                  <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                    <td className={`${tdBase} text-center text-zinc-500`}>
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className={tdBase}>
                      <span className="text-zinc-800 truncate max-w-[180px] inline-block">{row.title}</span>
                    </td>
                    <td className={tdBase}>{row.company || "—"}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.ddDate}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.createdDate}</td>
                    <td className={tdBase}>
                      <span className="text-red-500">{row.status}</span>
                    </td>
                    <td className={tdBase}>{row.submitter}</td>
                    <td className={tdBase}>
                      <div className="flex items-center justify-center text-zinc-400">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleEditQuestionnaire(row)}
                              className="hover:text-zinc-700 transition-colors"
                              aria-label="编辑"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>编辑</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-56">
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t flex-shrink-0">
          <p className="text-xs text-zinc-400">
            {footerNote}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1 rounded bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 text-xs font-medium">
                {page}
              </span>
              <button
                type="button"
                className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </button>
            </div>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
                className="h-8 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[20, 50, 100].map((size) => (
                  <option key={size} value={size}>{size} 条/页</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
