"use client"

import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
import {
  dueDiligenceReportListUrl,
  getDueDiligenceReport,
  publishDueDiligenceReport,
  updateDueDiligenceReport,
} from "@/lib/ma/due-diligence-reports"
import {
  DateField,
  EditorFooter,
  FormField,
  inputClass,
  PersonTagField,
  RichTextEditor,
  SectionHeader,
  UploadDropzone,
} from "./due-diligence-report-editor-parts"

export function DueDiligenceReportEditorView({
  preview = false,
  reportId = null,
}: {
  preview?: boolean
  reportId?: string | null
}) {
  const existing = reportId ? getDueDiligenceReport(reportId) : null
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [reportName, setReportName] = useState(existing?.title ?? "")
  const [company, setCompany] = useState(existing?.company ?? "")
  const [ddPerson, setDdPerson] = useState(existing?.ddPerson ?? "沈默")
  const [ddDate, setDdDate] = useState(existing?.ddDate ?? today)
  const [target, setTarget] = useState(existing?.target ?? "")
  const [position, setPosition] = useState(existing?.position ?? "")
  const [method, setMethod] = useState(existing?.method ?? "")
  const [recommender, setRecommender] = useState(existing?.recommender ?? "")
  const [detailContent, setDetailContent] = useState(existing?.detailContent ?? "")
  const [publishError, setPublishError] = useState("")

  const templateLabel = "尽调报告简易模版"

  function handlePublish() {
    if (!reportName.trim()) {
      setPublishError("请输入报告名称")
      return
    }
    if (!ddPerson.trim()) {
      setPublishError("请选择尽调人")
      return
    }
    const draft = {
      title: reportName.trim(),
      company: company.trim(),
      ddPerson: ddPerson.trim(),
      ddDate,
      target: target.trim(),
      position: position.trim(),
      method: method.trim(),
      recommender: recommender.trim(),
      detailContent: detailContent.trim(),
      templateId: "simple" as const,
    }
    if (reportId) {
      updateDueDiligenceReport(reportId, { ...draft, published: true })
    } else {
      publishDueDiligenceReport(draft)
    }
    window.location.href = dueDiligenceReportListUrl()
  }

  return (
    <div className="flex flex-col min-h-full bg-zinc-50">
      <div className="border-b bg-white px-6 py-3 flex-shrink-0">
        <div className="text-sm text-zinc-500">
          模板：<span className="text-zinc-700">{templateLabel}</span>
          {preview && <span className="ml-2 text-orange-500">（预览模式）</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 rounded-lg border border-zinc-200 bg-white p-5">
            <FormField label="报告名称：" required>
              <input
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <FormField label="尽调公司：">
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <FormField label="尽调人：" required>
                <PersonTagField value={ddPerson} onChange={setDdPerson} />
              </FormField>
              <FormField label="尽调日期：" required>
                <DateField value={ddDate} onChange={setDdDate} />
              </FormField>
          </div>

          <section id="basic-info" className="rounded-lg border border-zinc-200 bg-white p-5">
            <SectionHeader title="基本信息" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
              <FormField label="尽调对象：">
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label="职位：">
                <input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label="尽调方式：">
                <input
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label="推荐机构：">
                <input
                  value={recommender}
                  onChange={(e) => setRecommender(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
            </div>

            <div className="mb-5">
              <RichTextEditor label="详情内容" value={detailContent} onChange={setDetailContent} />
            </div>

            <UploadDropzone />
          </section>

          <section id="related-list" className="rounded-lg border border-zinc-200 bg-white p-5">
            <SectionHeader title="关联列表" />
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-red-300 hover:text-red-600 transition-colors"
            >
              <Plus className="h-4 w-4" />
              添加关联
            </button>
          </section>
        </div>
      </div>

      <EditorFooter publishError={publishError} onPublish={handlePublish} />
    </div>
  )
}
