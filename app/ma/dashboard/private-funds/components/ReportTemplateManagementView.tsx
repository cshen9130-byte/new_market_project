"use client"

import { useState } from "react"
import { Copy, LayoutTemplate, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import {
  DEMO_TEMPLATE_ID,
  buildDemoTemplate,
  createInputId,
  createTemplateId,
  defaultCanvas,
  loadReportTemplates,
  normalizeTemplate,
  saveReportTemplates,
  type ReportCustomTemplate,
} from "@/lib/ma/report-template-types"
import { ReportTemplateEditor } from "./ReportTemplateEditor"

const thBase = "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

function emptyTemplate(): ReportCustomTemplate {
  const productInputId = createInputId()
  return {
    id: createTemplateId(),
    name: "未命名模板",
    description: "",
    canvas: defaultCanvas(),
    inputs: [
      {
        id: productInputId,
        label: "目标产品",
        type: "product",
        placeholder: "请选择产品",
        required: true,
      },
      {
        id: createInputId(),
        label: "报告日期",
        type: "date",
        required: false,
      },
    ],
    elements: [],
    updatedAt: new Date().toISOString(),
  }
}

export function ReportTemplateManagementView() {
  const [templates, setTemplates] = useState<ReportCustomTemplate[]>(() => loadReportTemplates())
  const [editing, setEditing] = useState<ReportCustomTemplate | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  function persist(updated: ReportCustomTemplate[]) {
    setTemplates(updated)
    saveReportTemplates(updated)
  }

  function handleCreate() {
    setEditing(emptyTemplate())
  }

  function handleEdit(tpl: ReportCustomTemplate) {
    setEditing(normalizeTemplate(JSON.parse(JSON.stringify(tpl))))
  }

  function handleSave(tpl: ReportCustomTemplate) {
    const exists = templates.some((t) => t.id === tpl.id)
    const updated = exists
      ? templates.map((t) => (t.id === tpl.id ? tpl : t))
      : [...templates, tpl]
    persist(updated)
    setEditing(null)
  }

  function handleDelete(id: string) {
    persist(templates.filter((t) => t.id !== id))
    const newTotal = templates.length - 1
    const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE))
    if (page > maxPage) setPage(maxPage)
  }

  function handleDuplicate(tpl: ReportCustomTemplate) {
    const copy: ReportCustomTemplate = {
      ...JSON.parse(JSON.stringify(tpl)),
      id: createTemplateId(),
      name: `${tpl.name}（副本）`,
      updatedAt: new Date().toISOString(),
    }
    persist([...templates, copy])
    const newTotal = templates.length + 1
    setPage(Math.ceil(newTotal / PAGE_SIZE))
  }

  function handleAddDemo() {
    const demo = buildDemoTemplate()
    const fresh: ReportCustomTemplate = {
      ...demo,
      id: createTemplateId(),
      name: "私募基金季度报告（示例）",
      updatedAt: new Date().toISOString(),
    }
    persist([fresh, ...templates])
    setPage(1)
  }

  const hasDemoInList = templates.some((t) => t.id === DEMO_TEMPLATE_ID || t.name.startsWith("私募基金季度报告（示例）"))

  if (editing) {
    return (
      <ReportTemplateEditor
        template={editing}
        onBack={() => setEditing(null)}
        onSave={handleSave}
      />
    )
  }

  const pageRows = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE))

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-foreground">模板管理</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            设计一页通报告模板，拖拽组件并绑定用户输入字段
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!hasDemoInList && (
            <button
              type="button"
              onClick={handleAddDemo}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background hover:bg-muted/60 text-sm text-zinc-600 dark:text-zinc-300 font-medium transition-colors"
              title="加载内置季报示例模板"
            >
              <Sparkles className="h-4 w-4 text-amber-500" />
              加载示例
            </button>
          )}
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            新建模板
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                <th className={`${thBase} w-16 text-center`}>序号</th>
                <th className={thBase}>模板名称</th>
                <th className={`${thBase} hidden md:table-cell`}>描述</th>
                <th className={thBase}>组件数</th>
                <th className={thBase}>输入项</th>
                <th className={thBase}>更新时间</th>
                <th className={`${thBase} w-32 text-center`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="h-48">
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                      <LayoutTemplate className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                      <span className="text-sm">暂无自定义模板</span>
                      <button
                        type="button"
                        onClick={handleCreate}
                        className="text-sm text-red-500 hover:text-red-600 transition-colors"
                      >
                        创建第一个模板
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                pageRows.map((tpl, i) => {
                  const globalIdx = (page - 1) * PAGE_SIZE + i
                  return (
                    <tr
                      key={tpl.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-3 text-center text-zinc-500 text-xs">{globalIdx + 1}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">{tpl.name}</span>
                        {tpl.id === DEMO_TEMPLATE_ID && (
                          <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 px-1.5 py-0.5 rounded-full font-medium">
                            <Sparkles className="h-2.5 w-2.5" />示例
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-zinc-400 text-xs hidden md:table-cell max-w-[200px] truncate">
                        {tpl.description || "—"}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">{tpl.elements.length} 个</td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">{tpl.inputs.length} 项</td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">
                        {new Date(tpl.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEdit(tpl)}
                            className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(tpl)}
                            className="p-1.5 rounded text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                            title="复制"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(tpl.id)}
                            className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {templates.length > 0 && (
          <div className="flex items-center justify-end px-4 py-3 border-t flex-shrink-0">
            <div className="flex items-center gap-1 text-sm text-zinc-500">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1 rounded bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 text-xs font-medium">
                {page}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
