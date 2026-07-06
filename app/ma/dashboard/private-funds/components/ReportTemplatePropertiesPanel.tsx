"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, GripVertical, LayoutTemplate, Plus, Trash2 } from "lucide-react"
import {
  ELEMENT_TYPE_META,
  PF_MODULE_SECTION_OPTIONS,
  createColumnId,
  isPfModuleType,
  type TableColumnDef,
  type TemplateElement,
  type TemplateInputField,
} from "@/lib/ma/report-template-types"
import {
  METRIC_CATALOG,
  METRIC_PRESETS,
  PRODUCT_FIELD_CATALOG,
  metricByKey,
} from "@/lib/ma/report-template-metrics"
import { ELEMENT_STYLE_PRESETS } from "@/lib/ma/report-template-style-presets"

type Tab = "data" | "style" | "layout"

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] text-zinc-500 mb-1 block">{children}</label>
}

function SelectInput({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 px-2 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-8 px-2 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  unit = "",
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
}) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
        <span>{label}</span>
        <span>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-red-500"
      />
    </div>
  )
}

function TableColumnEditor({
  columns,
  onChange,
  productInputs,
}: {
  columns: TableColumnDef[]
  onChange: (cols: TableColumnDef[]) => void
  productInputs: TemplateInputField[]
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(columns[0]?.id ?? null)

  function updateCol(id: string, patch: Partial<TableColumnDef>) {
    onChange(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addColumn(metricKey?: string) {
    const m = metricKey ? metricByKey(metricKey) : undefined
    const col: TableColumnDef = m
      ? { id: createColumnId(), header: m.label, source: "metric", metricKey: m.key, format: m.format, align: "right", period: m.period }
      : { id: createColumnId(), header: "新列", source: "static", staticValue: "—", align: "left", format: "text" }
    onChange([...columns, col])
    setExpandedId(col.id)
  }

  function addPreset(presetId: string) {
    const preset = METRIC_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const newCols = preset.keys.map((key) => {
      const m = metricByKey(key)!
      return { id: createColumnId(), header: m.label, source: "metric" as const, metricKey: key, format: m.format, align: "right" as const, period: m.period }
    })
    onChange([...columns, ...newCols])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => addColumn()} className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted">
          + 自定义列
        </button>
        {METRIC_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => addPreset(p.id)} className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
            + {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {columns.map((col, idx) => (
          <div
            key={col.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx === null || dragIdx === idx) return
              const arr = [...columns]
              const [item] = arr.splice(dragIdx, 1)
              arr.splice(idx, 0, item)
              onChange(arr)
              setDragIdx(null)
            }}
            className="rounded border border-border bg-zinc-50/50 dark:bg-zinc-900/30"
          >
            <div className="flex items-center gap-1 px-2 py-1.5">
              <GripVertical className="h-3 w-3 text-zinc-400 shrink-0 cursor-grab" />
              <button type="button" className="flex-1 text-left text-xs font-medium truncate" onClick={() => setExpandedId(expandedId === col.id ? null : col.id)}>
                {col.header}
              </button>
              <button type="button" onClick={() => onChange(columns.filter((c) => c.id !== col.id))} className="p-0.5 text-zinc-400 hover:text-red-500">
                <Trash2 className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => setExpandedId(expandedId === col.id ? null : col.id)} className="p-0.5 text-zinc-400">
                {expandedId === col.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
            {expandedId === col.id && (
              <div className="px-2 pb-2 space-y-2 border-t border-border pt-2">
                <div>
                  <FieldLabel>列标题</FieldLabel>
                  <input
                    value={col.header}
                    onChange={(e) => updateCol(col.id, { header: e.target.value })}
                    className="w-full h-7 px-2 rounded border border-border bg-background text-xs"
                  />
                </div>
                <div>
                  <FieldLabel>数据来源</FieldLabel>
                  <SelectInput value={col.source} onChange={(v) => updateCol(col.id, { source: v as TableColumnDef["source"] })}>
                    <option value="metric">指标（自动计算）</option>
                    <option value="product_field">产品字段</option>
                    <option value="static">固定文本</option>
                    <option value="input">用户输入</option>
                  </SelectInput>
                </div>
                {col.source === "metric" && (
                  <>
                    <div>
                      <FieldLabel>指标</FieldLabel>
                      <SelectInput value={col.metricKey ?? ""} onChange={(v) => {
                        const m = metricByKey(v)
                        updateCol(col.id, { metricKey: v, header: col.header === "新列" ? m?.label ?? col.header : col.header, format: m?.format, period: m?.period })
                      }}>
                        <option value="">选择指标</option>
                        {Array.from(new Set(METRIC_CATALOG.map((m) => m.category))).map((cat) => (
                          <optgroup key={cat} label={cat}>
                            {METRIC_CATALOG.filter((m) => m.category === cat).map((m) => (
                              <option key={m.key} value={m.key}>{m.label}{m.description ? ` — ${m.description}` : ""}</option>
                            ))}
                          </optgroup>
                        ))}
                      </SelectInput>
                    </div>
                    <div>
                      <FieldLabel>计算区间</FieldLabel>
                      <SelectInput value={col.period ?? "近一年"} onChange={(v) => updateCol(col.id, { period: v })}>
                        {["近一周", "近一月", "近三月", "近六月", "近一年", "今年以来", "成立以来"].map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </SelectInput>
                    </div>
                  </>
                )}
                {col.source === "product_field" && (
                  <div>
                    <FieldLabel>产品字段</FieldLabel>
                    <SelectInput value={col.productField ?? ""} onChange={(v) => updateCol(col.id, { productField: v })}>
                      <option value="">选择字段</option>
                      {PRODUCT_FIELD_CATALOG.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                )}
                {col.source === "static" && (
                  <div>
                    <FieldLabel>固定值</FieldLabel>
                    <input value={col.staticValue ?? ""} onChange={(e) => updateCol(col.id, { staticValue: e.target.value })} className="w-full h-7 px-2 rounded border border-border bg-background text-xs" />
                  </div>
                )}
                {col.source === "input" && (
                  <div>
                    <FieldLabel>绑定输入</FieldLabel>
                    <SelectInput value={col.bindInputId ?? ""} onChange={(v) => updateCol(col.id, { bindInputId: v || undefined })}>
                      <option value="">选择输入项</option>
                      {productInputs.map((inp) => (
                        <option key={inp.id} value={inp.id}>{inp.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>格式</FieldLabel>
                    <SelectInput value={col.format ?? "text"} onChange={(v) => updateCol(col.id, { format: v as TableColumnDef["format"] })}>
                      <option value="text">文本</option>
                      <option value="percent">百分比</option>
                      <option value="number">数值</option>
                      <option value="currency">金额</option>
                      <option value="date">日期</option>
                      <option value="integer">整数</option>
                    </SelectInput>
                  </div>
                  <div>
                    <FieldLabel>对齐</FieldLabel>
                    <SelectInput value={col.align ?? "left"} onChange={(v) => updateCol(col.id, { align: v as TableColumnDef["align"] })}>
                      <option value="left">左</option>
                      <option value="center">中</option>
                      <option value="right">右</option>
                    </SelectInput>
                  </div>
                </div>
                <div>
                  <FieldLabel>列宽权重</FieldLabel>
                  <NumberInput value={col.widthWeight ?? 1} min={1} max={5} onChange={(v) => updateCol(col.id, { widthWeight: v })} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => addColumn()} className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-red-500 border border-dashed border-red-200 rounded hover:bg-red-50 dark:hover:bg-red-950/20">
        <Plus className="h-3.5 w-3.5" /> 添加列
      </button>
    </div>
  )
}

export function ReportTemplatePropertiesPanel({
  element,
  inputs,
  onChange,
  onDelete,
}: {
  element: TemplateElement | null
  inputs: TemplateInputField[]
  onChange: (el: TemplateElement) => void
  onDelete: () => void
}) {
  const [tab, setTab] = useState<Tab>("data")

  if (!element) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs px-4 text-center gap-2">
        <LayoutTemplate className="h-8 w-8 text-zinc-300" />
        <span>选中画布上的元素以编辑属性</span>
        <span className="text-[10px] text-zinc-400">支持数据绑定、样式、阴影、透明度等</span>
      </div>
    )
  }

  const meta = ELEMENT_TYPE_META[element.type]
  const style = element.props.style ?? {}
  const productInputs = inputs.filter((i) => i.type === "product" || i.type === "products" || i.type === "benchmark")

  function patchProps(patch: Partial<TemplateElement["props"]>) {
    onChange({ ...element, props: { ...element.props, ...patch } })
  }

  function patchStyle(patch: Partial<typeof style>) {
    patchProps({ style: { ...style, ...patch } })
  }

  function applyStylePreset(presetId: string) {
    const preset = ELEMENT_STYLE_PRESETS.find((p) => p.id === presetId)
    patchProps({ stylePreset: presetId, style: preset ? { ...preset.style } : undefined })
  }

  const isPfModule = isPfModuleType(element.type)
  const isChart = !isPfModule && (element.type.includes("chart") || element.type === "heatmap" || element.type === "benchmark-compare")
  const isText = ["title", "subtitle", "text", "rich-text", "date-display"].includes(element.type)
  const isTable = element.type === "table"
  const isMetric = ["metric-card", "metric-grid", "kpi-row"].includes(element.type)
  const sectionOptions = PF_MODULE_SECTION_OPTIONS[element.type] ?? []

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold">{meta.label}</span>
        <button type="button" onClick={onDelete} className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex border-b shrink-0">
        {(["data", "style", "layout"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              "flex-1 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-red-500 text-red-600" : "border-transparent text-zinc-400 hover:text-foreground",
            ].join(" ")}
          >
            {t === "data" ? "数据" : t === "style" ? "样式" : "布局"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm min-h-0">
        {tab === "data" && (
          <>
            {/* ── pf-module: product binding + sections + period ─────── */}
            {isPfModule && (
              <>
                <div>
                  <FieldLabel>绑定产品 <span className="text-red-500">*</span></FieldLabel>
                  <SelectInput
                    value={element.props.bindProductInputId ?? element.props.bindInputId ?? ""}
                    onChange={(v) => patchProps({ bindProductInputId: v || undefined, bindInputId: v || undefined })}
                  >
                    <option value="">不绑定</option>
                    {productInputs.map((inp) => (
                      <option key={inp.id} value={inp.id}>{inp.label}（{inp.type}）</option>
                    ))}
                  </SelectInput>
                  <p className="text-[10px] text-zinc-400 mt-1">私募基金模块组件将从绑定产品自动加载数据，与基金详情页同源。</p>
                </div>

                <div>
                  <FieldLabel>数据区间</FieldLabel>
                  <SelectInput
                    value={element.props.chartPeriod ?? element.props.metricPeriod ?? "近一年"}
                    onChange={(v) => patchProps({ chartPeriod: v, metricPeriod: v, tablePeriod: v })}
                  >
                    {["近一周", "近一月", "近三月", "近六月", "近一年", "今年以来", "成立以来"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </SelectInput>
                </div>

                {sectionOptions.length > 0 && (
                  <div>
                    <FieldLabel>包含子模块</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {sectionOptions.map((sec) => {
                        const cur = element.props.moduleSections ?? sectionOptions
                        const active = cur.includes(sec)
                        return (
                          <label key={sec} className="flex items-center gap-1 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={(e) =>
                                patchProps({
                                  moduleSections: e.target.checked
                                    ? [...cur.filter((s) => s !== sec), sec]
                                    : cur.filter((s) => s !== sec),
                                })
                              }
                              className="rounded border-border accent-red-500"
                            />
                            {sec}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <FieldLabel>基准对比</FieldLabel>
                  <SelectInput
                    value={element.props.benchmarkInputId ?? ""}
                    onChange={(v) => patchProps({ benchmarkInputId: v || undefined })}
                  >
                    <option value="">不对比基准</option>
                    {inputs.filter((i) => i.type === "benchmark").map((inp) => (
                      <option key={inp.id} value={inp.id}>{inp.label}</option>
                    ))}
                  </SelectInput>
                </div>
              </>
            )}

            {/* ── non-pf: chart/table/metric product binding ─────────── */}
            {!isPfModule && (isChart || isTable || isMetric || element.type === "product-info" || element.type === "benchmark-compare") && (
              <div>
                <FieldLabel>绑定产品</FieldLabel>
                <SelectInput
                  value={element.props.bindProductInputId ?? element.props.bindInputId ?? ""}
                  onChange={(v) => patchProps({ bindProductInputId: v || undefined, bindInputId: v || undefined })}
                >
                  <option value="">不绑定</option>
                  {productInputs.map((inp) => (
                    <option key={inp.id} value={inp.id}>{inp.label}（{inp.type}）</option>
                  ))}
                </SelectInput>
                <p className="text-[10px] text-zinc-400 mt-1">绑定后，表格/图表将基于所选产品净值自动计算指标（如卡玛比率、夏普比率等）</p>
              </div>
            )}

            {!isPfModule && isText && !element.props.bindInputId && (
              <div>
                <FieldLabel>文本内容</FieldLabel>
                <textarea value={element.props.text ?? ""} onChange={(e) => patchProps({ text: e.target.value })} rows={4} className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs resize-none" />
              </div>
            )}

            {!isPfModule && isText && (
              <>
                <div>
                  <FieldLabel>绑定输入</FieldLabel>
                  <SelectInput value={element.props.bindInputId ?? ""} onChange={(v) => patchProps({ bindInputId: v || undefined })}>
                    <option value="">固定文本</option>
                    {inputs.map((inp) => (
                      <option key={inp.id} value={inp.id}>{inp.label}</option>
                    ))}
                  </SelectInput>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>字号</FieldLabel>
                    <NumberInput value={element.props.fontSize ?? 14} min={8} max={72} onChange={(v) => patchProps({ fontSize: v })} />
                  </div>
                  <div>
                    <FieldLabel>对齐</FieldLabel>
                    <SelectInput value={element.props.align ?? "left"} onChange={(v) => patchProps({ align: v as "left" | "center" | "right" })}>
                      <option value="left">左</option>
                      <option value="center">中</option>
                      <option value="right">右</option>
                    </SelectInput>
                  </div>
                </div>
              </>
            )}

            {isChart && (
              <>
                <div>
                  <FieldLabel>展示区间</FieldLabel>
                  <SelectInput value={element.props.chartPeriod ?? "近一年"} onChange={(v) => patchProps({ chartPeriod: v })}>
                    {["近一周", "近一月", "近三月", "近六月", "近一年", "成立以来"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>主色</FieldLabel>
                  <input type="color" value={element.props.chartColor ?? "#ef4444"} onChange={(e) => patchProps({ chartColor: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.showLegend ?? true} onChange={(e) => patchProps({ showLegend: e.target.checked })} />图例</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.showGrid ?? true} onChange={(e) => patchProps({ showGrid: e.target.checked })} />网格</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.showDataLabels ?? false} onChange={(e) => patchProps({ showDataLabels: e.target.checked })} />数据标签</label>
                </div>
                {element.type === "benchmark-compare" && (
                  <div>
                    <FieldLabel>基准输入</FieldLabel>
                    <SelectInput value={element.props.benchmarkInputId ?? ""} onChange={(v) => patchProps({ benchmarkInputId: v || undefined })}>
                      <option value="">选择基准</option>
                      {inputs.filter((i) => i.type === "benchmark").map((inp) => (
                        <option key={inp.id} value={inp.id}>{inp.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                )}
              </>
            )}

            {isMetric && (
              <>
                <div>
                  <FieldLabel>指标</FieldLabel>
                  <SelectInput value={element.props.metricKey ?? ""} onChange={(v) => {
                    const m = metricByKey(v)
                    patchProps({ metricKey: v, metricLabel: m?.label })
                  }}>
                    <option value="">选择指标</option>
                    {METRIC_CATALOG.map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>展示区间</FieldLabel>
                  <SelectInput value={element.props.metricPeriod ?? "近一年"} onChange={(v) => patchProps({ metricPeriod: v })}>
                    {["近一月", "近三月", "近六月", "近一年", "成立以来"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </SelectInput>
                </div>
              </>
            )}

            {isTable && (
              <>
                <div>
                  <FieldLabel>行数据来源</FieldLabel>
                  <SelectInput value={element.props.tableRowSource ?? "single_product"} onChange={(v) => patchProps({ tableRowSource: v as "single_product" | "product_list" })}>
                    <option value="single_product">单个产品（绑定上方产品输入）</option>
                    <option value="product_list">多个产品（绑定多选产品输入）</option>
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>默认计算区间</FieldLabel>
                  <SelectInput value={element.props.tablePeriod ?? "近一年"} onChange={(v) => patchProps({ tablePeriod: v })}>
                    {["近一周", "近一月", "近三月", "近六月", "近一年", "成立以来"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </SelectInput>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.tableStriped ?? true} onChange={(e) => patchProps({ tableStriped: e.target.checked })} />斑马纹</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.tableShowIndex ?? false} onChange={(e) => patchProps({ tableShowIndex: e.target.checked })} />序号列</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={element.props.tableCompact ?? false} onChange={(e) => patchProps({ tableCompact: e.target.checked })} />紧凑模式</label>
                </div>
                <div>
                  <FieldLabel>表头背景</FieldLabel>
                  <input type="color" value={element.props.tableHeaderBg ?? "#fafafa"} onChange={(e) => patchProps({ tableHeaderBg: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
                </div>
                <div>
                  <FieldLabel>表格列配置（{element.props.tableColumns?.length ?? 0} 列）</FieldLabel>
                  <TableColumnEditor
                    columns={element.props.tableColumns ?? []}
                    onChange={(cols) => patchProps({ tableColumns: cols })}
                    productInputs={inputs}
                  />
                </div>
              </>
            )}

            {(element.type === "image" || element.type === "logo") && (
              <>
                <div>
                  <FieldLabel>图片 URL</FieldLabel>
                  <input value={element.props.imageUrl ?? ""} onChange={(e) => patchProps({ imageUrl: e.target.value })} className="w-full h-8 px-2 rounded border border-border bg-background text-xs" placeholder="https://..." />
                </div>
                <div>
                  <FieldLabel>填充方式</FieldLabel>
                  <SelectInput value={element.props.objectFit ?? "contain"} onChange={(v) => patchProps({ objectFit: v as "cover" | "contain" | "fill" })}>
                    <option value="contain">包含</option>
                    <option value="cover">覆盖</option>
                    <option value="fill">拉伸</option>
                  </SelectInput>
                </div>
              </>
            )}
          </>
        )}

        {tab === "style" && (
          <>
            <div>
              <FieldLabel>样式模板</FieldLabel>
              <SelectInput value={element.props.stylePreset ?? "default"} onChange={applyStylePreset}>
                {ELEMENT_STYLE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}{p.description ? ` — ${p.description}` : ""}</option>
                ))}
              </SelectInput>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>背景色</FieldLabel>
                <input type="color" value={style.backgroundColor ?? "#ffffff"} onChange={(e) => patchStyle({ backgroundColor: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
              </div>
              <div>
                <FieldLabel>文字色</FieldLabel>
                <input type="color" value={style.textColor ?? "#18181b"} onChange={(e) => patchStyle({ textColor: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
              </div>
            </div>
            <SliderRow label="背景透明度" value={style.backgroundOpacity ?? 100} onChange={(v) => patchStyle({ backgroundOpacity: v })} unit="%" />
            <SliderRow label="整体透明度" value={style.opacity ?? 100} onChange={(v) => patchStyle({ opacity: v })} unit="%" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>边框宽度</FieldLabel>
                <NumberInput value={style.borderWidth ?? 0} min={0} max={8} onChange={(v) => patchStyle({ borderWidth: v })} />
              </div>
              <div>
                <FieldLabel>圆角</FieldLabel>
                <NumberInput value={style.borderRadius ?? 0} min={0} max={32} onChange={(v) => patchStyle({ borderRadius: v })} />
              </div>
            </div>
            <div>
              <FieldLabel>边框颜色</FieldLabel>
              <input type="color" value={style.borderColor ?? "#e4e4e7"} onChange={(e) => patchStyle({ borderColor: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
            </div>
            <div>
              <FieldLabel>边框样式</FieldLabel>
              <SelectInput value={style.borderStyle ?? "solid"} onChange={(v) => patchStyle({ borderStyle: v as typeof style.borderStyle })}>
                <option value="none">无</option>
                <option value="solid">实线</option>
                <option value="dashed">虚线</option>
                <option value="dotted">点线</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>内边距</FieldLabel>
              <NumberInput value={style.padding ?? 8} min={0} max={48} onChange={(v) => patchStyle({ padding: v })} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={style.shadowEnabled ?? false} onChange={(e) => patchStyle({ shadowEnabled: e.target.checked })} />
              启用阴影
            </label>
            {style.shadowEnabled && (
              <>
                <SliderRow label="阴影模糊" value={style.shadowBlur ?? 8} onChange={(v) => patchStyle({ shadowBlur: v })} max={40} />
                <SliderRow label="阴影扩散" value={style.shadowSpread ?? 0} onChange={(v) => patchStyle({ shadowSpread: v })} max={20} />
                <SliderRow label="阴影透明度" value={style.shadowOpacity ?? 15} onChange={(v) => patchStyle({ shadowOpacity: v })} unit="%" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>阴影 X</FieldLabel>
                    <NumberInput value={style.shadowOffsetX ?? 0} min={-20} max={20} onChange={(v) => patchStyle({ shadowOffsetX: v })} />
                  </div>
                  <div>
                    <FieldLabel>阴影 Y</FieldLabel>
                    <NumberInput value={style.shadowOffsetY ?? 2} min={-20} max={20} onChange={(v) => patchStyle({ shadowOffsetY: v })} />
                  </div>
                </div>
                <div>
                  <FieldLabel>阴影颜色</FieldLabel>
                  <input type="color" value={style.shadowColor ?? "#000000"} onChange={(e) => patchStyle({ shadowColor: e.target.value })} className="h-8 w-full rounded border border-border cursor-pointer" />
                </div>
              </>
            )}
            <div>
              <FieldLabel>字重</FieldLabel>
              <SelectInput value={String(style.fontWeight ?? "normal")} onChange={(v) => patchStyle({ fontWeight: v === "bold" ? "bold" : Number(v) || "normal" })}>
                <option value="normal">正常</option>
                <option value="500">中等</option>
                <option value="600">半粗</option>
                <option value="bold">粗体</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>行高</FieldLabel>
              <NumberInput value={style.lineHeight ?? 1.5} min={1} max={3} step={0.1} onChange={(v) => patchStyle({ lineHeight: v })} />
            </div>
          </>
        )}

        {tab === "layout" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>X 位置 (%)</FieldLabel>
                <NumberInput value={Math.round(element.x * 10) / 10} min={0} max={100} step={0.5} onChange={(v) => onChange({ ...element, x: v })} />
              </div>
              <div>
                <FieldLabel>Y 位置 (%)</FieldLabel>
                <NumberInput value={Math.round(element.y * 10) / 10} min={0} max={100} step={0.5} onChange={(v) => onChange({ ...element, y: v })} />
              </div>
              <div>
                <FieldLabel>宽度 (%)</FieldLabel>
                <NumberInput value={Math.round(element.width * 10) / 10} min={4} max={100} step={0.5} onChange={(v) => onChange({ ...element, width: v })} />
              </div>
              <div>
                <FieldLabel>高度 (%)</FieldLabel>
                <NumberInput value={Math.round(element.height * 10) / 10} min={2} max={100} step={0.5} onChange={(v) => onChange({ ...element, height: v })} />
              </div>
            </div>
            {(element.type === "divider" || element.type === "page-break") && (
              <>
                <div>
                  <FieldLabel>线条样式</FieldLabel>
                  <SelectInput value={element.props.dividerStyle ?? "solid"} onChange={(v) => patchProps({ dividerStyle: v as "solid" | "dashed" | "dotted" })}>
                    <option value="solid">实线</option>
                    <option value="dashed">虚线</option>
                    <option value="dotted">点线</option>
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>线条粗细</FieldLabel>
                  <NumberInput value={element.props.dividerThickness ?? 1} min={1} max={8} onChange={(v) => patchProps({ dividerThickness: v })} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
