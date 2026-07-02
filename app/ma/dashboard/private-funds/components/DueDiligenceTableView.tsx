"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  Download,
  Expand,
  Italic,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import type {
  CellFormat,
  DueDiligenceTableColumn,
  DueDiligenceTableRow,
  TableCellFormats,
} from "@/lib/ma/due-diligence-table"
import {
  DD_TABLE_COLUMNS,
  TABLE_ACTION_WIDTH,
  TABLE_INDEX_WIDTH,
  cellFormatKey,
  clearCellFormat,
  createDueDiligenceTableRow,
  getCellFormat,
  getDueDiligenceTableNaturalWidth,
  loadCellFormats,
  loadDueDiligenceTableRows,
  patchCellFormat,
  resetDueDiligenceTableFromSeed,
  rowMatchesKeyword,
  saveCellFormats,
  saveDueDiligenceTableRows,
  updateDueDiligenceTableRow,
} from "@/lib/ma/due-diligence-table"
import {
  countExtractableRows,
  extractTableRowsToCalendar,
} from "@/lib/ma/due-diligence-table-to-calendar"
import { RepresentativeProductCell } from "./RepresentativeProductCell"

// ── Constants ──────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.5
const ZOOM_STEP = 0.1
const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24]

const PALETTE_COLORS = [
  "#000000", "#404040", "#595959", "#808080", "#bfbfbf", "#ffffff",
  "#ff0000", "#ff4500", "#ff8c00", "#ffc000", "#ffff00", "#ffe066",
  "#92d050", "#00b050", "#00b0f0", "#0070c0", "#7030a0", "#ff00ff",
  "#ffc7ce", "#ffd966", "#e2efda", "#b4d9f0", "#dce6f1", "#f4ccf4",
]

// ── Selection helpers ──────────────────────────────────────────────────────

type CellCoord = { rowId: string; colKey: DueDiligenceTableColumn["key"] }

type SelectionState =
  | { kind: "none" }
  | { kind: "range"; anchor: CellCoord; focus: CellCoord }
  | { kind: "rows"; rowIds: string[] }
  | { kind: "columns"; colKeys: DueDiligenceTableColumn["key"][] }

function resolveRangeCells(
  anchor: CellCoord,
  focus: CellCoord,
  tableRows: DueDiligenceTableRow[],
): CellCoord[] {
  const rowIds = tableRows.map((r) => r.id)
  const colKeys = DD_TABLE_COLUMNS.map((c) => c.key)
  const r0 = rowIds.indexOf(anchor.rowId)
  const r1 = rowIds.indexOf(focus.rowId)
  const c0 = colKeys.indexOf(anchor.colKey)
  const c1 = colKeys.indexOf(focus.colKey)
  if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) return []
  const rMin = Math.min(r0, r1)
  const rMax = Math.max(r0, r1)
  const cMin = Math.min(c0, c1)
  const cMax = Math.max(c0, c1)
  const result: CellCoord[] = []
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      result.push({ rowId: rowIds[r], colKey: colKeys[c] })
    }
  }
  return result
}

function getSelectionCells(
  selection: SelectionState,
  tableRows: DueDiligenceTableRow[],
): CellCoord[] {
  if (selection.kind === "none") return []
  if (selection.kind === "rows") {
    const coords: CellCoord[] = []
    for (const rowId of selection.rowIds) {
      for (const col of DD_TABLE_COLUMNS) {
        coords.push({ rowId, colKey: col.key })
      }
    }
    return coords
  }
  if (selection.kind === "columns") {
    const coords: CellCoord[] = []
    for (const row of tableRows) {
      for (const colKey of selection.colKeys) {
        coords.push({ rowId: row.id, colKey })
      }
    }
    return coords
  }
  return resolveRangeCells(selection.anchor, selection.focus, tableRows)
}

function selectionCellKey(rowId: string, colKey: string): string {
  return `${rowId}::${colKey}`
}

function buildSelectionCellSet(
  selection: SelectionState,
  tableRows: DueDiligenceTableRow[],
): Set<string> {
  const set = new Set<string>()
  for (const { rowId, colKey } of getSelectionCells(selection, tableRows)) {
    set.add(selectionCellKey(rowId, colKey))
  }
  return set
}

function hasSelection(selection: SelectionState): boolean {
  return selection.kind !== "none"
}

function selectionSummary(selection: SelectionState, tableRows: DueDiligenceTableRow[]): string {
  const cells = getSelectionCells(selection, tableRows)
  if (cells.length === 0) return ""
  if (selection.kind === "rows") return `已选 ${selection.rowIds.length} 行`
  if (selection.kind === "columns") return `已选 ${selection.colKeys.length} 列`
  if (cells.length === 1) return "已选 1 个单元格"
  return `已选 ${cells.length} 个单元格`
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clampZoom(v: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
}

function fitZoom(containerPx: number): number {
  const natural = getDueDiligenceTableNaturalWidth()
  if (containerPx <= 0 || natural <= containerPx) return 1
  return clampZoom(Math.floor((containerPx / natural) * 100) / 100)
}

function formatToStyle(fmt: CellFormat): CSSProperties {
  const style: CSSProperties = {}
  if (fmt.bold) style.fontWeight = "700"
  if (fmt.italic) style.fontStyle = "italic"
  const deco: string[] = []
  if (fmt.underline) deco.push("underline")
  if (fmt.strikethrough) deco.push("line-through")
  if (deco.length) style.textDecoration = deco.join(" ")
  if (fmt.color) style.color = fmt.color
  if (fmt.bgColor) style.backgroundColor = fmt.bgColor
  if (fmt.align) style.textAlign = fmt.align
  if (fmt.fontSize) style.fontSize = fmt.fontSize
  return style
}

// ── Color palette popover ──────────────────────────────────────────────────

function ColorPalette({
  current,
  onSelect,
  onClose,
  showNoFill,
}: {
  current?: string
  onSelect: (hex: string) => void
  onClose: () => void
  showNoFill?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 rounded-md border border-zinc-200 bg-white p-2 shadow-xl"
    >
      <div className="grid grid-cols-6 gap-1">
        {PALETTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(c)
              onClose()
            }}
            className="h-5 w-5 rounded border transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              borderColor: c === "#ffffff" ? "#d1d5db" : c,
              outline: current === c ? "2px solid #3b82f6" : undefined,
              outlineOffset: "1px",
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2">
        {showNoFill && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect("")
              onClose()
            }}
            className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            无填充
          </button>
        )}
        <span className="text-xs text-zinc-500">自定义：</span>
        <input
          type="color"
          defaultValue={current ?? "#000000"}
          onChange={(e) => onSelect(e.target.value)}
          className="h-5 w-8 cursor-pointer rounded border-0 p-0"
        />
      </div>
    </div>
  )
}

// ── Formatting toolbar ─────────────────────────────────────────────────────

function FormattingToolbar({
  format,
  disabled,
  selectionHint,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFormat,
  onClearFormat,
}: {
  format: CellFormat
  disabled: boolean
  selectionHint?: string
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onFormat: (patch: Partial<CellFormat>) => void
  onClearFormat: () => void
}) {
  const [openPicker, setOpenPicker] = useState<"text" | "bg" | null>(null)

  function iconBtn(active: boolean, title: string, onClick: () => void, children: JSX.Element) {
    return (
      <button
        type="button"
        title={title}
        onMouseDown={(e) => { e.preventDefault(); onClick() }}
        className={[
          "flex h-7 w-7 items-center justify-center rounded transition-colors",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-200",
          active ? "bg-red-50 text-red-600 ring-1 ring-red-200" : "text-zinc-700",
        ].join(" ")}
        disabled={disabled}
      >
        {children}
      </button>
    )
  }

  const sep = <div className="mx-1 h-5 w-px flex-shrink-0 bg-zinc-300" />

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1">
      {/* Undo / Redo */}
      <button
        type="button"
        title="撤销 (Ctrl+Z)"
        onMouseDown={(e) => { e.preventDefault(); onUndo() }}
        disabled={!canUndo}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" /><path d="M3 13C5 8 9.5 5 15 5a9 9 0 0 1 6 16" />
        </svg>
      </button>
      <button
        type="button"
        title="重做 (Ctrl+Y)"
        onMouseDown={(e) => { e.preventDefault(); onRedo() }}
        disabled={!canRedo}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" /><path d="M21 13C19 8 14.5 5 9 5a9 9 0 0 0-6 16" />
        </svg>
      </button>

      {sep}

      {/* Font size */}
      <select
        title="字号"
        value={format.fontSize ?? 13}
        onChange={(e) => onFormat({ fontSize: Number(e.target.value) })}
        disabled={disabled}
        className="h-7 w-14 rounded border border-zinc-200 bg-white px-1 text-xs text-zinc-700 outline-none focus:border-red-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {sep}

      {/* Bold */}
      {iconBtn(!!format.bold, "加粗 (Ctrl+B)", () => onFormat({ bold: !format.bold }),
        <Bold className="h-3.5 w-3.5" />)}
      {/* Italic */}
      {iconBtn(!!format.italic, "斜体 (Ctrl+I)", () => onFormat({ italic: !format.italic }),
        <Italic className="h-3.5 w-3.5" />)}
      {/* Underline */}
      {iconBtn(!!format.underline, "下划线 (Ctrl+U)", () => onFormat({ underline: !format.underline }),
        <Underline className="h-3.5 w-3.5" />)}
      {/* Strikethrough */}
      {iconBtn(!!format.strikethrough, "删除线", () => onFormat({ strikethrough: !format.strikethrough }),
        <Strikethrough className="h-3.5 w-3.5" />)}

      {sep}

      {/* Text color */}
      <div className="relative">
        <button
          type="button"
          title="字体颜色"
          disabled={disabled}
          onMouseDown={(e) => { e.preventDefault(); if (!disabled) setOpenPicker(v => v === "text" ? null : "text") }}
          className={[
            "flex h-7 w-8 flex-col items-center justify-center gap-0 rounded transition-colors",
            disabled ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-200",
          ].join(" ")}
        >
          <span className="text-xs font-bold leading-none text-zinc-800" style={{ color: format.color }}>A</span>
          <div className="mt-0.5 h-1 w-5 rounded-sm" style={{ backgroundColor: format.color ?? "#000000" }} />
        </button>
        {openPicker === "text" && (
          <ColorPalette
            current={format.color}
            onSelect={(c) => onFormat({ color: c })}
            onClose={() => setOpenPicker(null)}
          />
        )}
      </div>

      {/* Background color */}
      <div className="relative">
        <button
          type="button"
          title="填充颜色"
          disabled={disabled}
          onMouseDown={(e) => { e.preventDefault(); if (!disabled) setOpenPicker(v => v === "bg" ? null : "bg") }}
          className={[
            "flex h-7 w-8 flex-col items-center justify-center gap-0 rounded transition-colors",
            disabled ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-200",
          ].join(" ")}
        >
          <span className="text-xs leading-none text-zinc-600">▣</span>
          <div
            className="mt-0.5 h-1 w-5 rounded-sm border border-zinc-300"
            style={{ backgroundColor: format.bgColor ?? "transparent" }}
          />
        </button>
        {openPicker === "bg" && (
          <ColorPalette
            current={format.bgColor}
            showNoFill
            onSelect={(c) => onFormat({ bgColor: c || "" })}
            onClose={() => setOpenPicker(null)}
          />
        )}
      </div>

      {sep}

      {/* Alignment */}
      {iconBtn(!format.align || format.align === "left", "左对齐", () => onFormat({ align: "left" }),
        <AlignLeft className="h-3.5 w-3.5" />)}
      {iconBtn(format.align === "center", "居中对齐", () => onFormat({ align: "center" }),
        <AlignCenter className="h-3.5 w-3.5" />)}
      {iconBtn(format.align === "right", "右对齐", () => onFormat({ align: "right" }),
        <AlignRight className="h-3.5 w-3.5" />)}

      {sep}

      {/* Clear format */}
      <button
        type="button"
        title="清除格式"
        onMouseDown={(e) => { e.preventDefault(); onClearFormat() }}
        disabled={disabled}
        className="flex h-7 items-center gap-1 rounded px-2 text-xs text-zinc-600 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="h-3 w-3" />
        清除格式
      </button>

      {!disabled && selectionHint && (
        <span className="ml-auto text-xs text-zinc-400">{selectionHint}</span>
      )}
      {disabled && (
        <span className="ml-auto text-xs text-zinc-400">点击行号、列头或拖拽选择单元格后设置格式</span>
      )}
    </div>
  )
}

// ── Editable cell ──────────────────────────────────────────────────────────

function EditableCell({
  cellId,
  value,
  width,
  multiline,
  format,
  isActive,
  isSelected,
  onChange,
  onActivate,
}: {
  cellId: string
  value: string
  width: number
  multiline?: boolean
  format: CellFormat
  isActive: boolean
  isSelected: boolean
  onChange: (next: string) => void
  onActivate: () => void
}) {
  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const baseClass = [
    "block rounded border bg-transparent px-1 text-xs text-zinc-800 outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
  ].join(" ")

  if (multiline) {
    return (
      <textarea
        data-cell={cellId}
        value={value}
        rows={2}
        style={style}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onActivate}
        className={`${baseClass} resize-y leading-snug py-0.5 min-h-[2.25rem]`}
      />
    )
  }
  return (
    <input
      type="text"
      data-cell={cellId}
      value={value}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onActivate}
      className={`${baseClass} h-7 py-0`}
    />
  )
}

// ── Export helper ──────────────────────────────────────────────────────────

function exportRowsToXlsx(rows: DueDiligenceTableRow[]) {
  void import("xlsx-js-style").then((XLSX) => {
    const headers = ["序号", ...DD_TABLE_COLUMNS.map((c) => c.label)]
    const body = rows.map((row, i) => [i + 1, ...DD_TABLE_COLUMNS.map((c) => row[c.key])])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "尽调统计")
    XLSX.writeFile(wb, `私募尽调统计表_${new Date().toISOString().slice(0, 10)}.xlsx`)
  })
}

// ── History helpers ────────────────────────────────────────────────────────

type Snapshot = { rows: DueDiligenceTableRow[]; formats: TableCellFormats }
const MAX_HISTORY = 50

// ── Main view ──────────────────────────────────────────────────────────────

export function DueDiligenceTableView() {
  const [rows, setRows] = useState<DueDiligenceTableRow[]>([])
  const [formats, setFormats] = useState<TableCellFormats>({})
  const [keyword, setKeyword] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selection, setSelection] = useState<SelectionState>({ kind: "none" })
  const [focusCell, setFocusCell] = useState<CellCoord | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])

  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ anchor: CellCoord; dragging: boolean } | null>(null)

  // ── Snapshot / undo-redo ──

  const snapshot = useCallback(
    (prevRows: DueDiligenceTableRow[], prevFormats: TableCellFormats) => {
      setUndoStack((s) => [...s.slice(-MAX_HISTORY + 1), { rows: prevRows, formats: prevFormats }])
      setRedoStack([])
    },
    [],
  )

  const persistRows = useCallback(
    (prevRows: DueDiligenceTableRow[], next: DueDiligenceTableRow[], prevFormats: TableCellFormats) => {
      snapshot(prevRows, prevFormats)
      setRows(next)
      saveDueDiligenceTableRows(next)
    },
    [snapshot],
  )

  const persistFormats = useCallback(
    (prevRows: DueDiligenceTableRow[], prevFormats: TableCellFormats, next: TableCellFormats) => {
      snapshot(prevRows, prevFormats)
      setFormats(next)
      saveCellFormats(next)
    },
    [snapshot],
  )

  function undo() {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack
      const prev = stack[stack.length - 1]
      setRedoStack((r) => [{ rows, formats }, ...r.slice(0, MAX_HISTORY - 1)])
      setRows(prev.rows)
      setFormats(prev.formats)
      saveDueDiligenceTableRows(prev.rows)
      saveCellFormats(prev.formats)
      return stack.slice(0, -1)
    })
  }

  function redo() {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack
      const next = stack[0]
      setUndoStack((u) => [...u.slice(-MAX_HISTORY + 1), { rows, formats }])
      setRows(next.rows)
      setFormats(next.formats)
      saveDueDiligenceTableRows(next.rows)
      saveCellFormats(next.formats)
      return stack.slice(1)
    })
  }

  // ── Load / storage sync ──

  const reload = useCallback(() => {
    setRows(loadDueDiligenceTableRows())
    setFormats(loadCellFormats())
  }, [])

  useEffect(() => { reload(); setHydrated(true) }, [reload])

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "dd_diligence_table_rows" || e.key === "dd_diligence_table_formats") reload()
    }
    function onFocus() { reload() }
    window.addEventListener("storage", onStorage)
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("focus", onFocus)
    }
  }, [reload])

  useEffect(() => {
    function onFsChange() { setIsFullscreen(document.fullscreenElement === rootRef.current) }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // ── Zoom / fit ──

  const applyFitZoom = useCallback(() => {
    const w = containerRef.current?.clientWidth ?? 0
    setZoom(fitZoom(w))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    applyFitZoom()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(applyFitZoom)
    ro.observe(container)
    return () => ro.disconnect()
  }, [hydrated, applyFitZoom])

  // ── Filtered rows ──

  const filteredRows = useMemo(
    () => rows.filter((row) => rowMatchesKeyword(row, keyword)),
    [rows, keyword],
  )

  const selectedCellSet = useMemo(
    () => buildSelectionCellSet(selection, filteredRows),
    [selection, filteredRows],
  )

  const selectedRowSet = useMemo(() => {
    if (selection.kind !== "rows") return new Set<string>()
    return new Set(selection.rowIds)
  }, [selection])

  const selectedColSet = useMemo(() => {
    if (selection.kind !== "columns") return new Set<string>()
    return new Set(selection.colKeys)
  }, [selection])

  const formatReferenceCell = useMemo<CellCoord | null>(() => {
    if (focusCell) return focusCell
    const cells = getSelectionCells(selection, filteredRows)
    return cells[0] ?? null
  }, [focusCell, selection, filteredRows])

  const activeFmt = useMemo<CellFormat>(() => {
    if (!formatReferenceCell) return {}
    return getCellFormat(formats, formatReferenceCell.rowId, formatReferenceCell.colKey)
  }, [formats, formatReferenceCell])

  const selectionHint = useMemo(
    () => selectionSummary(selection, filteredRows),
    [selection, filteredRows],
  )

  function focusCellInput(rowId: string, colKey: DueDiligenceTableColumn["key"]) {
    const el = containerRef.current?.querySelector(
      `[data-cell="${selectionCellKey(rowId, colKey)}"]`,
    ) as HTMLElement | null
    el?.focus()
    setFocusCell({ rowId, colKey })
  }

  function handleCellMouseDown(
    rowId: string,
    colKey: DueDiligenceTableColumn["key"],
    e: ReactMouseEvent,
  ) {
    if (e.button !== 0) return
    e.preventDefault()
    const coord = { rowId, colKey }
    dragRef.current = { anchor: coord, dragging: false }
    setIsDragging(true)
    if (e.shiftKey && selection.kind === "range") {
      setSelection({ kind: "range", anchor: selection.anchor, focus: coord })
    } else {
      setSelection({ kind: "range", anchor: coord, focus: coord })
    }
  }

  function handleCellMouseEnter(
    rowId: string,
    colKey: DueDiligenceTableColumn["key"],
  ) {
    if (!dragRef.current) return
    dragRef.current.dragging = true
    setSelection({
      kind: "range",
      anchor: dragRef.current.anchor,
      focus: { rowId, colKey },
    })
  }

  function handleSelectRow(rowId: string, e: ReactMouseEvent) {
    e.stopPropagation()
    setFocusCell(null)
    if (e.shiftKey && selection.kind === "rows") {
      const lastId = selection.rowIds[selection.rowIds.length - 1]
      const rowIds = filteredRows.map((r) => r.id)
      const i0 = rowIds.indexOf(lastId)
      const i1 = rowIds.indexOf(rowId)
      if (i0 >= 0 && i1 >= 0) {
        const start = Math.min(i0, i1)
        const end = Math.max(i0, i1)
        setSelection({ kind: "rows", rowIds: rowIds.slice(start, end + 1) })
        return
      }
    }
    setSelection({ kind: "rows", rowIds: [rowId] })
  }

  function handleSelectColumn(
    colKey: DueDiligenceTableColumn["key"],
    e: ReactMouseEvent,
  ) {
    e.stopPropagation()
    setFocusCell(null)
    if (e.shiftKey && selection.kind === "columns") {
      const lastKey = selection.colKeys[selection.colKeys.length - 1]
      const colKeys = DD_TABLE_COLUMNS.map((c) => c.key)
      const i0 = colKeys.indexOf(lastKey)
      const i1 = colKeys.indexOf(colKey)
      if (i0 >= 0 && i1 >= 0) {
        const start = Math.min(i0, i1)
        const end = Math.max(i0, i1)
        setSelection({ kind: "columns", colKeys: colKeys.slice(start, end + 1) })
        return
      }
    }
    setSelection({ kind: "columns", colKeys: [colKey] })
  }

  useEffect(() => {
    function onMouseUp() {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setIsDragging(false)
      setFocusCell({ rowId: drag.anchor.rowId, colKey: drag.anchor.colKey })
      if (!drag.dragging) {
        requestAnimationFrame(() => focusCellInput(drag.anchor.rowId, drag.anchor.colKey))
      }
    }
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [])

  // ── Format handlers ──

  function applyFormatToSelection(patch: Partial<CellFormat> & { bgColor?: string }) {
    const cells = getSelectionCells(selection, filteredRows)
    if (cells.length === 0) return
    let next = formats
    const clearBg = patch.bgColor === ""
    const effectivePatch = clearBg ? {} : patch
    for (const { rowId, colKey } of cells) {
      if (clearBg) {
        const key = cellFormatKey(rowId, colKey)
        const existing = next[key]
        if (!existing?.bgColor) continue
        const { bgColor: _, ...rest } = existing
        next = { ...next }
        if (Object.keys(rest).length === 0) delete next[key]
        else next[key] = rest
        continue
      }
      next = patchCellFormat(next, rowId, colKey, effectivePatch)
    }
    persistFormats(rows, formats, next)
  }

  function clearSelectionFormat() {
    const cells = getSelectionCells(selection, filteredRows)
    if (cells.length === 0) return
    let next = formats
    for (const { rowId, colKey } of cells) {
      next = clearCellFormat(next, rowId, colKey)
    }
    persistFormats(rows, formats, next)
  }

  // ── Cell change ──

  function handleCellChange(rowId: string, key: DueDiligenceTableColumn["key"], value: string) {
    const next = updateDueDiligenceTableRow(rows, rowId, { [key]: value })
    persistRows(rows, next, formats)
  }

  function handleRepresentativeProductChange(
    rowId: string,
    value: string,
    link?: { beianHao: string } | null,
  ) {
    const patch: Parameters<typeof updateDueDiligenceTableRow>[2] = {
      representativeProduct: value,
    }
    if (link === null) {
      patch.representativeProductBeianHao = null
    } else if (link) {
      patch.representativeProductBeianHao = link.beianHao
    }
    const next = updateDueDiligenceTableRow(rows, rowId, patch)
    persistRows(rows, next, formats)
  }

  function handleAddRow() {
    const newRow = createDueDiligenceTableRow()
    persistRows(rows, [newRow, ...rows], formats)
  }

  function handleDeleteRow(id: string) {
    if (!window.confirm("确定删除这条尽调记录吗？")) return
    const next = rows.filter((r) => r.id !== id)
    persistRows(rows, next, formats)
  }

  function handleResetSeed() {
    if (!window.confirm("将用初始 Excel 数据覆盖当前表格，是否继续？")) return
    const next = resetDueDiligenceTableFromSeed()
    persistRows(rows, next, formats)
  }

  function handleExtractToCalendar() {
    const { withDate, alreadySynced } = countExtractableRows(rows)
    if (withDate === 0) {
      alert("没有可提取的尽调记录（需填写尽调日期）。")
      return
    }
    const toAdd = withDate - alreadySynced
    if (toAdd <= 0) {
      alert("所有含日期的尽调记录已同步到尽调日历。")
      return
    }
    const msg = alreadySynced > 0
      ? `将 ${toAdd} 条尽调记录提取到尽调日历（${alreadySynced} 条已同步将跳过），是否继续？`
      : `将 ${toAdd} 条尽调记录提取到尽调日历，是否继续？`
    if (!window.confirm(msg)) return
    const result = extractTableRowsToCalendar(rows)
    alert(`提取完成：新增 ${result.added} 条${result.skipped > 0 ? `，跳过 ${result.skipped} 条（已同步）` : ""}。`)
  }

  // ── Keyboard shortcuts ──

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!hasSelection(selection)) return
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl) return
    switch (e.key.toLowerCase()) {
      case "b": e.preventDefault(); applyFormatToSelection({ bold: !activeFmt.bold }); break
      case "i": e.preventDefault(); applyFormatToSelection({ italic: !activeFmt.italic }); break
      case "u": e.preventDefault(); applyFormatToSelection({ underline: !activeFmt.underline }); break
      case "z": e.preventDefault(); e.shiftKey ? redo() : undo(); break
      case "y": e.preventDefault(); redo(); break
    }
  }

  // ── Fullscreen ──

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await rootRef.current?.requestFullscreen()
    } catch { /* ignore */ }
  }

  const totalWidth = getDueDiligenceTableNaturalWidth()

  return (
    <div
      ref={rootRef}
      onKeyDown={handleKeyDown}
      className={[
        "flex h-full min-h-0 flex-col bg-background focus-within:outline-none",
        isFullscreen ? "fixed inset-0 z-50 h-screen w-screen" : "",
      ].join(" ")}
    >
      {/* ── Header toolbar ── */}
      <div className="flex-shrink-0 border-b bg-background px-5 pb-3 pt-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-foreground">尽调表格</h1>
            <p className="mt-0.5 text-xs text-zinc-500">团队协作收集尽调信息，可直接在单元格中编辑。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
              {isFullscreen ? <><Minimize2 className="h-3.5 w-3.5" />退出全屏</> : <><Expand className="h-3.5 w-3.5" />全屏</>}
            </button>
            <button type="button" onClick={() => exportRowsToXlsx(filteredRows)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
              <Download className="h-3.5 w-3.5" />导出 Excel
            </button>
            <button type="button" onClick={handleExtractToCalendar}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
              <CalendarDays className="h-3.5 w-3.5" />提取到尽调日历
            </button>
            <button type="button" onClick={handleResetSeed}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" />恢复初始数据
            </button>
            <button type="button" onClick={handleAddRow}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors">
              <Plus className="h-3.5 w-3.5" />添加记录
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input type="search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索基金公司、经理、策略、结论…"
              className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100" />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-md border border-zinc-200 bg-white">
              <button type="button" onClick={() => setZoom(z => clampZoom(Number((z - ZOOM_STEP).toFixed(2))))}
                disabled={zoom <= ZOOM_MIN + 0.01}
                className="flex h-8 w-8 items-center justify-center text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[2.75rem] border-x border-zinc-200 text-center text-xs font-medium tabular-nums text-zinc-700 py-1">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" onClick={() => setZoom(z => clampZoom(Number((z + ZOOM_STEP).toFixed(2))))}
                disabled={zoom >= ZOOM_MAX - 0.01}
                className="flex h-8 w-8 items-center justify-center text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={applyFitZoom}
                className="flex h-8 items-center gap-1 border-l border-zinc-200 px-2.5 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Maximize2 className="h-3 w-3" />适应页面
              </button>
            </div>
            <span className="text-xs text-zinc-500 tabular-nums whitespace-nowrap">
              共 {filteredRows.length} 条{keyword.trim() ? ` / ${rows.length} 总计` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* ── Formatting toolbar (Excel-like) ── */}
      <FormattingToolbar
        format={activeFmt}
        disabled={!hasSelection(selection)}
        selectionHint={selectionHint}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={undo}
        onRedo={redo}
        onFormat={applyFormatToSelection}
        onClearFormat={clearSelectionFormat}
      />

      {/* ── Table ── */}
      <div
        ref={containerRef}
        className={["min-h-0 flex-1 overflow-auto", isDragging ? "select-none" : ""].join(" ")}
      >
        {!hydrated ? (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-500">加载中…</div>
        ) : filteredRows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            {rows.length === 0 ? (
              <>
                <p className="text-sm text-zinc-500">暂无记录，数据未能加载</p>
                <button
                  type="button"
                  onClick={() => { const next = resetDueDiligenceTableFromSeed(); setRows(next) }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" />
                  从初始 Excel 数据恢复
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500">没有匹配的搜索结果</p>
            )}
          </div>
        ) : (
          <div
            className="origin-top-left"
            style={{ zoom, width: totalWidth, minHeight: "100%" } as CSSProperties}
          >
            <table
              className="border-collapse"
              style={{ tableLayout: "fixed", width: totalWidth }}
            >
              <colgroup>
                <col style={{ width: TABLE_INDEX_WIDTH }} />
                {DD_TABLE_COLUMNS.map((col) => (
                  <col key={col.key} style={{ width: col.width }} />
                ))}
                <col style={{ width: TABLE_ACTION_WIDTH }} />
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 border-b border-zinc-200 bg-zinc-50/95 py-2 text-center text-xs font-semibold text-zinc-600 shadow-[1px_0_0_0_#e4e4e7]">
                    序号
                  </th>
                  {DD_TABLE_COLUMNS.map((col) => {
                    const colSelected = selectedColSet.has(col.key)
                    return (
                      <th
                        key={col.key}
                        title="点击选择整列，Shift+点击扩展"
                        onMouseDown={(e) => handleSelectColumn(col.key, e)}
                        className={[
                          "overflow-hidden border-b border-zinc-200 py-2 text-left text-xs font-semibold text-zinc-600 cursor-pointer select-none transition-colors",
                          colSelected ? "bg-blue-100 text-blue-800" : "bg-zinc-50/95 hover:bg-zinc-100",
                        ].join(" ")}
                        style={{ paddingLeft: 4, paddingRight: 2 }}
                      >
                        {col.label}
                      </th>
                    )
                  })}
                  <th className="border-b border-zinc-200 bg-zinc-50/95 py-2 text-center text-xs font-semibold text-zinc-600">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => {
                  const rowSelected = selectedRowSet.has(row.id)
                  return (
                    <tr key={row.id} className="group hover:bg-red-50/30">
                    <td
                      title="点击选择整行，Shift+点击扩展"
                      onMouseDown={(e) => handleSelectRow(row.id, e)}
                      className={[
                        "sticky left-0 z-10 border-b border-zinc-100 py-0.5 text-center text-xs font-medium shadow-[1px_0_0_0_#f4f4f5] cursor-pointer select-none transition-colors",
                        rowSelected
                          ? "bg-blue-100 text-blue-800"
                          : "bg-white text-zinc-500 group-hover:bg-red-50/30",
                      ].join(" ")}
                    >
                      {index + 1}
                    </td>
                    {DD_TABLE_COLUMNS.map((col) => {
                      const cellId = selectionCellKey(row.id, col.key)
                      const isSelected = selectedCellSet.has(cellId)
                      const isActive =
                        focusCell?.rowId === row.id && focusCell?.colKey === col.key
                      const fmt = getCellFormat(formats, row.id, col.key)
                      return (
                        <td
                          key={col.key}
                          onMouseDown={(e) => handleCellMouseDown(row.id, col.key, e)}
                          onMouseEnter={() => handleCellMouseEnter(row.id, col.key)}
                          onDoubleClick={() => {
                            if (col.key !== "representativeProduct") return
                            setFocusCell({ rowId: row.id, colKey: col.key })
                            setSelection({
                              kind: "range",
                              anchor: { rowId: row.id, colKey: col.key },
                              focus: { rowId: row.id, colKey: col.key },
                            })
                            requestAnimationFrame(() => focusCellInput(row.id, col.key))
                          }}
                          className={[
                            "border-b border-zinc-100 py-0.5 align-top transition-colors",
                            col.key === "representativeProduct" ? "overflow-visible" : "overflow-hidden",
                            isSelected && !isActive ? "bg-blue-50/50 ring-1 ring-inset ring-blue-300/70" : "",
                          ].join(" ")}
                          style={{ paddingLeft: 2, paddingRight: 2 }}
                        >
                          {col.key === "representativeProduct" ? (
                            <RepresentativeProductCell
                              cellId={cellId}
                              value={row.representativeProduct}
                              linkedBeianHao={row.representativeProductBeianHao}
                              width={col.width}
                              format={fmt}
                              isActive={isActive}
                              isSelected={isSelected}
                              onActivate={() => {
                                setFocusCell({ rowId: row.id, colKey: col.key })
                                setSelection({
                                  kind: "range",
                                  anchor: { rowId: row.id, colKey: col.key },
                                  focus: { rowId: row.id, colKey: col.key },
                                })
                              }}
                              onChange={(value, link) =>
                                handleRepresentativeProductChange(row.id, value, link)
                              }
                            />
                          ) : (
                            <EditableCell
                              cellId={cellId}
                              value={row[col.key]}
                              width={col.width}
                              multiline={col.multiline}
                              format={fmt}
                              isActive={isActive}
                              isSelected={isSelected}
                              onActivate={() => {
                                setFocusCell({ rowId: row.id, colKey: col.key })
                                setSelection({
                                  kind: "range",
                                  anchor: { rowId: row.id, colKey: col.key },
                                  focus: { rowId: row.id, colKey: col.key },
                                })
                              }}
                              onChange={(value) => handleCellChange(row.id, col.key, value)}
                            />
                          )}
                        </td>
                      )
                    })}
                    <td className="border-b border-zinc-100 py-0.5 text-center align-top">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
