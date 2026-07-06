"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  Eye,
  FileText,
  GripVertical,
  Image,
  LayoutGrid,
  LineChart,
  ListOrdered,
  Minus,
  PieChart,
  Save,
  Settings2,
  Star,
  Table2,
  TrendingDown,
  Type,
  Wallet,
} from "lucide-react"
import {
  ELEMENT_TYPE_META,
  TOOLBOX_GROUPS,
  createElementId,
  type ReportCustomTemplate,
  type TemplateElement,
  type TemplateElementType,
} from "@/lib/ma/report-template-types"
import { CANVAS_SIZE_PRESETS, PAGE_STYLE_PRESETS, styleToCss } from "@/lib/ma/report-template-style-presets"
import { ReportTemplateElementPreview } from "./ReportTemplateElementPreview"
import { ReportTemplatePropertiesPanel } from "./ReportTemplatePropertiesPanel"
import { ReportTemplateUserInputsDialog } from "./ReportTemplateUserInputsDialog"

const ICON_MAP: Partial<Record<TemplateElementType, typeof Type>> = {
  title: Type,
  subtitle: Type,
  text: Type,
  "rich-text": Type,
  "date-display": Calendar,
  "nav-chart": LineChart,
  "return-chart": LineChart,
  "drawdown-chart": TrendingDown,
  "rolling-vol-chart": LineChart,
  "rolling-return-chart": LineChart,
  "bar-chart": BarChart3,
  "pie-chart": PieChart,
  heatmap: Calendar,
  "benchmark-compare": LineChart,
  table: Table2,
  "metric-card": LayoutGrid,
  "metric-grid": LayoutGrid,
  "kpi-row": ListOrdered,
  "product-info": Building2,
  image: Image,
  logo: Image,
  divider: Minus,
  // private fund modules
  "pf-product-elements": FileText,
  "pf-performance": LineChart,
  "pf-metrics": Star,
  "pf-interval-stats": Table2,
  "pf-monthly-calendar": Calendar,
  "pf-drawdown": TrendingDown,
  "pf-win-rate": BarChart3,
  "pf-score": Star,
  "pf-holdings": Wallet,
  "pf-risk": BookOpen,
}

type DragState =
  | { kind: "move"; elId: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; elId: string; startX: number; startY: number; origW: number; origH: number }

export function ReportTemplateEditor({
  template,
  onBack,
  onSave,
}: {
  template: ReportCustomTemplate
  onBack: () => void
  onSave: (template: ReportCustomTemplate) => void
}) {
  const [draft, setDraft] = useState<ReportCustomTemplate>(template)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inputsOpen, setInputsOpen] = useState(false)
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const selected = draft.elements.find((e) => e.id === selectedId) ?? null
  const canvas = draft.canvas

  const addElement = useCallback((type: TemplateElementType, xPct: number, yPct: number) => {
    const meta = ELEMENT_TYPE_META[type]
    const el: TemplateElement = {
      id: createElementId(),
      type,
      x: Math.max(0, Math.min(100 - meta.defaultW, xPct - meta.defaultW / 2)),
      y: Math.max(0, Math.min(100 - meta.defaultH, yPct - meta.defaultH / 2)),
      width: meta.defaultW,
      height: meta.defaultH,
      props: JSON.parse(JSON.stringify(meta.defaultProps)),
    }
    setDraft((d) => ({ ...d, elements: [...d.elements, el] }))
    setSelectedId(el.id)
  }, [])

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault()
    const type = e.dataTransfer.getData("element-type") as TemplateElementType
    if (!type || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    addElement(type, ((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100)
  }

  function startMove(el: TemplateElement, e: ReactMouseEvent) {
    if (previewMode) return
    e.stopPropagation()
    setSelectedId(el.id)
    dragRef.current = { kind: "move", elId: el.id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y }
  }

  function startResize(el: TemplateElement, e: ReactMouseEvent) {
    if (previewMode) return
    e.stopPropagation()
    dragRef.current = { kind: "resize", elId: el.id, startX: e.clientX, startY: e.clientY, origW: el.width, origH: el.height }
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag || !canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const dxPct = ((e.clientX - drag.startX) / rect.width) * 100
      const dyPct = ((e.clientY - drag.startY) / rect.height) * 100
      setDraft((d) => ({
        ...d,
        elements: d.elements.map((el) => {
          if (el.id !== drag.elId) return el
          if (drag.kind === "move") {
            return { ...el, x: Math.max(0, Math.min(100 - el.width, drag.origX + dxPct)), y: Math.max(0, Math.min(100 - el.height, drag.origY + dyPct)) }
          }
          return { ...el, width: Math.max(4, Math.min(100 - el.x, drag.origW + dxPct)), height: Math.max(2, Math.min(100 - el.y, drag.origH + dyPct)) }
        }),
      }))
    }
    function onUp() { dragRef.current = null }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [])

  function applyCanvasPreset(presetId: string) {
    const preset = CANVAS_SIZE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setDraft((d) => ({
      ...d,
      canvas: { ...d.canvas, preset: presetId, widthPx: preset.width, heightPx: preset.height },
    }))
  }

  const pageBg = styleToCss({
    backgroundColor: canvas.backgroundColor ?? "#ffffff",
    backgroundOpacity: canvas.backgroundOpacity ?? 100,
  })

  const scale = Math.min(1, 900 / canvas.widthPx)

  return (
    <div className="flex flex-col h-full min-h-0 -m-5">
      <div className="flex items-center gap-2 px-5 py-3 border-b bg-background flex-shrink-0 flex-wrap">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="h-4 w-px bg-border" />
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="text-sm font-semibold bg-transparent border-none focus:outline-none min-w-[100px] max-w-[200px]"
          placeholder="模板名称"
        />
        <div className="flex-1" />
        <select
          value={canvas.preset ?? "custom"}
          onChange={(e) => applyCanvasPreset(e.target.value)}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          {CANVAS_SIZE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          type="number"
          value={canvas.widthPx}
          onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, widthPx: Number(e.target.value) || 800, preset: "custom" } }))}
          className="h-8 w-16 px-2 rounded border border-border bg-background text-xs"
          title="宽度 px"
        />
        <span className="text-xs text-zinc-400">×</span>
        <input
          type="number"
          value={canvas.heightPx}
          onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, heightPx: Number(e.target.value) || 600, preset: "custom" } }))}
          className="h-8 w-16 px-2 rounded border border-border bg-background text-xs"
          title="高度 px"
        />
        <button type="button" onClick={() => setPageSettingsOpen((o) => !o)} className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border text-xs hover:bg-muted">
          <Settings2 className="h-3.5 w-3.5" /> 页面
        </button>
        <button type="button" onClick={() => setInputsOpen(true)} className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border text-xs hover:bg-muted">
          用户输入 ({draft.inputs.length})
        </button>
        <button
          type="button"
          onClick={() => { setPreviewMode((p) => !p); setSelectedId(null) }}
          className={`inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs ${previewMode ? "border-red-300 bg-red-50 text-red-600" : "border-border hover:bg-muted"}`}
        >
          <Eye className="h-3.5 w-3.5" /> {previewMode ? "退出预览" : "预览"}
        </button>
        <button type="button" onClick={() => onSave({ ...draft, updatedAt: new Date().toISOString() })} className="inline-flex items-center gap-1 h-8 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-xs font-medium">
          <Save className="h-3.5 w-3.5" /> 保存
        </button>
      </div>

      {pageSettingsOpen && (
        <div className="px-5 py-3 border-b bg-zinc-50/80 dark:bg-zinc-900/40 flex flex-wrap gap-4 text-xs">
          <div>
            <label className="text-zinc-500 block mb-1">页面背景</label>
            <input
              type="color"
              value={canvas.backgroundColor ?? "#ffffff"}
              onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, backgroundColor: e.target.value } }))}
              className="h-8 w-20 rounded border cursor-pointer"
            />
          </div>
          <div className="w-40">
            <label className="text-zinc-500 block mb-1">背景透明度 {canvas.backgroundOpacity ?? 100}%</label>
            <input
              type="range"
              min={0}
              max={100}
              value={canvas.backgroundOpacity ?? 100}
              onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, backgroundOpacity: Number(e.target.value) } }))}
              className="w-full accent-red-500"
            />
          </div>
          <div>
            <label className="text-zinc-500 block mb-1">页面边距</label>
            <input
              type="number"
              min={0}
              max={80}
              value={canvas.padding ?? 24}
              onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, padding: Number(e.target.value) } }))}
              className="h-8 w-16 px-2 rounded border border-border bg-background"
            />
          </div>
          <div>
            <label className="text-zinc-500 block mb-1">页面风格</label>
            <select
              value={canvas.pageStylePreset ?? "page-white"}
              onChange={(e) => {
                const p = PAGE_STYLE_PRESETS.find((x) => x.id === e.target.value)
                setDraft((d) => ({
                  ...d,
                  canvas: {
                    ...d.canvas,
                    pageStylePreset: e.target.value,
                    backgroundColor: p?.style.backgroundColor ?? d.canvas.backgroundColor,
                  },
                }))
              }}
              className="h-8 px-2 rounded border border-border bg-background"
            >
              {PAGE_STYLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-1">
            <input
              type="checkbox"
              checked={canvas.showGrid ?? true}
              onChange={(e) => setDraft((d) => ({ ...d, canvas: { ...d.canvas, showGrid: e.target.checked } }))}
            />
            显示网格
          </label>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {!previewMode && (
          <aside className="w-48 border-r bg-zinc-50/50 dark:bg-zinc-900/20 flex-shrink-0 overflow-y-auto">
            <div className="px-3 py-2 border-b text-xs font-semibold text-zinc-500 sticky top-0 bg-inherit z-10">组件库</div>
            {TOOLBOX_GROUPS.map((group) => (
              <div key={group.label} className="p-2">
                <div className="text-[10px] font-semibold text-zinc-400 px-1 mb-1">{group.label}</div>
                <div className="space-y-1">
                  {group.items.map((type) => {
                    const Icon = ICON_MAP[type] ?? LayoutGrid
                    return (
                      <div
                        key={type}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("element-type", type); e.dataTransfer.effectAllowed = "copy" }}
                        onDoubleClick={() => addElement(type, 50, 20)}
                        className="flex items-center gap-1.5 px-2 py-2 rounded-md border border-border bg-background cursor-grab hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/20 text-xs"
                      >
                        <Icon className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        <span className="truncate flex-1">{ELEMENT_TYPE_META[type].label}</span>
                        <GripVertical className="h-3 w-3 text-zinc-300" />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="px-3 pb-3 text-[10px] text-zinc-400">拖拽或双击添加 · 右侧可配置数据与样式</p>
          </aside>
        )}

        <div className="flex-1 min-w-0 overflow-auto bg-zinc-200/60 dark:bg-zinc-950/50 p-6">
          <div className="mx-auto" style={{ width: canvas.widthPx * scale }}>
            <div className="text-[10px] text-zinc-500 mb-1 text-center">
              {canvas.widthPx} × {canvas.heightPx} px
              {canvas.heightPx > 1200 && " · 可滚动长页"}
            </div>
            <div
              ref={canvasRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCanvasDrop}
              onClick={() => !previewMode && setSelectedId(null)}
              className="relative shadow-xl border border-zinc-300 dark:border-zinc-600 mx-auto"
              style={{
                width: canvas.widthPx * scale,
                height: canvas.heightPx * scale,
                ...pageBg,
                padding: (canvas.padding ?? 24) * scale,
              }}
            >
              {!previewMode && canvas.showGrid !== false && (
                <div
                  className="absolute inset-0 pointer-events-none opacity-25"
                  style={{
                    backgroundImage: "radial-gradient(circle, #a1a1aa 1px, transparent 1px)",
                    backgroundSize: `${(canvas.gridSize ?? 20) * scale}px ${(canvas.gridSize ?? 20) * scale}px`,
                  }}
                />
              )}

              {draft.elements.length === 0 && !previewMode && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400 pointer-events-none">
                  从左侧拖拽组件到此处
                </div>
              )}

              {draft.elements.map((el) => (
                <div
                  key={el.id}
                  className="absolute"
                  style={{
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.width}%`,
                    height: `${el.height}%`,
                  }}
                  onMouseDown={(e) => startMove(el, e)}
                >
                  <ReportTemplateElementPreview
                    el={el}
                    inputs={draft.inputs}
                    selected={!previewMode && selectedId === el.id}
                    onSelect={() => !previewMode && setSelectedId(el.id)}
                  />
                  {!previewMode && selectedId === el.id && (
                    <div onMouseDown={(e) => startResize(el, e)} className="absolute -bottom-1 -right-1 h-3 w-3 bg-red-500 rounded-sm cursor-se-resize z-10" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {!previewMode && (
          <aside className="w-72 border-l bg-background flex-shrink-0 min-h-0">
            <ReportTemplatePropertiesPanel
              element={selected}
              inputs={draft.inputs}
              onChange={(el) => setDraft((d) => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? el : e)) }))}
              onDelete={() => {
                if (!selectedId) return
                setDraft((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== selectedId) }))
                setSelectedId(null)
              }}
            />
          </aside>
        )}
      </div>

      <ReportTemplateUserInputsDialog
        open={inputsOpen}
        onOpenChange={setInputsOpen}
        inputs={draft.inputs}
        onSave={(inputs) => setDraft((d) => ({ ...d, inputs }))}
      />
    </div>
  )
}
