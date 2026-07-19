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
  type ReactNode,
} from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  Download,
  ChevronDown,
  Expand,
  Filter,
  Italic,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  Upload,
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
  buildDdTimeOptions,
  DD_METHOD_OPTIONS,
  cellFormatKey,
  clearCellFormat,
  createDueDiligenceTableRow,
  deleteDueDiligenceTableRows,
  getCellFormat,
  getDueDiligenceTableNaturalWidth,
  insertDueDiligenceTableRowsAt,
  loadDueDiligenceTableFromServer,
  patchCellFormat,
  pruneCellFormatsForRows,
  resetDueDiligenceTableFromSeed,
  rowMatchesKeyword,
  saveDueDiligenceTableToServer,
  updateDueDiligenceTableRow,
} from "@/lib/ma/due-diligence-table"
import {
  countExtractableRows,
  extractTableRowsToCalendar,
  parseTableDate,
  rowsPendingCalendarSync,
  sortDueDiligenceTableRowsByDateAsc,
} from "@/lib/ma/due-diligence-table-to-calendar"
import type { DueDiligenceSchedule } from "@/lib/ma/due-diligence-schedules"
import {
  loadDueDiligenceSchedulesFromServer,
  saveDueDiligenceSchedulesToServer,
} from "@/lib/ma/due-diligence-schedules"
import { AddMyTrackingDialog } from "@/components/ma/add-my-tracking-dialog"
import { AddToTeamTrackingDialog } from "@/components/ma/add-to-team-tracking-dialog"
import { AddToTeamTrackingButton } from "@/components/ma/add-to-team-tracking-button"
import { AddToTrackingButton } from "@/components/ma/add-to-tracking-button"
import {
  AddDueDiligenceRecordDialog,
  recordFormToRowData,
  type DueDiligenceTableRecordForm,
} from "./AddDueDiligenceRecordDialog"
import { RepresentativeProductCell } from "./RepresentativeProductCell"
import { StrategySelectCell } from "./StrategySelectCell"
import { StrategyMultiSelectCell } from "./StrategyMultiSelectCell"
import { DdDateCell } from "./DdDateCell"
import { DdSelectCell } from "./DdSelectCell"
import { DdMaterialsCell } from "./DdMaterialsCell"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { splitFundPoolMemberships } from "@/lib/client/tracking-pools"
import {
  loadTeamStrategyTree,
  migrateRowTeamStrategies,
  teamStrategyL1Options,
  teamStrategyL2Options,
  teamStrategyL3Options,
  type TeamStrategyNode,
} from "@/lib/ma/team-strategy-tree"
import {
  fetchSavedTeamStrategies,
  getStrategyCellMatchStatus,
  getStrategyLevel3MatchStatus,
  hasSavedTeamStrategy,
  rowHasAnyTableStrategy,
  syncTeamStrategiesToDatabase,
  type SavedTeamStrategiesMap,
} from "@/lib/ma/due-diligence-team-strategies"
import {
  strategyLevel3ForDatabase,
  strategyLevel3FromDatabase,
} from "@/lib/ma/strategy-level3"
import {
  buildDdMaterialsAutoFillPatch,
  buildDdMaterialsFolderIndex,
  getDdMaterialsDocumentsForRow,
  resolveDdMaterialsFolderPath,
  type DdMaterialsDocument,
  type DdMaterialsFolderIndex,
} from "@/lib/ma/due-diligence-materials"

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

function primaryRowId(rowIds: string[], tableRows: DueDiligenceTableRow[]): string | null {
  const set = new Set(rowIds)
  for (const row of tableRows) {
    if (set.has(row.id)) return row.id
  }
  return rowIds[0] ?? null
}

function selectedRowIdsFromSelection(
  selection: SelectionState,
  tableRows: DueDiligenceTableRow[],
): string[] {
  if (selection.kind === "rows") return selection.rowIds
  if (selection.kind === "range") {
    const anchorIdx = tableRows.findIndex((row) => row.id === selection.anchor.rowId)
    const focusIdx = tableRows.findIndex((row) => row.id === selection.focus.rowId)
    if (anchorIdx < 0 || focusIdx < 0) return []
    const start = Math.min(anchorIdx, focusIdx)
    const end = Math.max(anchorIdx, focusIdx)
    return tableRows.slice(start, end + 1).map((row) => row.id)
  }
  return []
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
  rowActions,
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
  rowActions?: {
    count: number
    onInsertAbove: () => void
    onInsertBelow: () => void
    onDelete: () => void
  }
}) {
  const [openPicker, setOpenPicker] = useState<"text" | "bg" | null>(null)

  function iconBtn(active: boolean, title: string, onClick: () => void, children: ReactNode) {
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
      {disabled && !rowActions && (
        <span className="ml-auto text-xs text-zinc-400">点击行号、列头或拖拽选择单元格后设置格式</span>
      )}

      {rowActions && (
        <>
          {!disabled && sep}
          <button
            type="button"
            title="在上方插入行"
            onMouseDown={(e) => { e.preventDefault(); rowActions.onInsertAbove() }}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-200"
          >
            <Plus className="h-3 w-3" />
            在上方插入
          </button>
          <button
            type="button"
            title="在下方插入行"
            onMouseDown={(e) => { e.preventDefault(); rowActions.onInsertBelow() }}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-200"
          >
            <Plus className="h-3 w-3" />
            在下方插入
          </button>
          <button
            type="button"
            title="删除选中行"
            onMouseDown={(e) => { e.preventDefault(); rowActions.onDelete() }}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
            删除{rowActions.count > 1 ? ` (${rowActions.count} 行)` : "行"}
          </button>
          {disabled && (
            <span className="ml-auto text-xs text-zinc-400">
              已选 {rowActions.count} 行 · 右键行可插入或删除
            </span>
          )}
        </>
      )}
    </div>
  )
}

type FundPoolMembership = { pool_key: string; pool_label: string }

async function fetchFundPoolMemberships(beian_hao: string): Promise<FundPoolMembership[]> {
  try {
    const res = await fetch(`/ma/api/ops/fund-tags?beian_hao=${encodeURIComponent(beian_hao)}`)
    const json = await res.json()
    return Array.isArray(json?.pools) ? (json.pools as FundPoolMembership[]) : []
  } catch {
    return []
  }
}

function TrackingPoolsCell({
  pools,
  loading,
  width,
}: {
  pools: FundPoolMembership[]
  loading?: boolean
  width: number
}) {
  const text = pools.map((p) => p.pool_label).join("、")
  return (
    <div
      className="min-h-[1.75rem] px-1 text-xs leading-snug text-zinc-700"
      style={{ width: width - 4 }}
      title={text || undefined}
    >
      {loading ? (
        <span className="text-zinc-400">…</span>
      ) : text ? (
        <span className="line-clamp-2">{text}</span>
      ) : (
        <span className="text-zinc-400">—</span>
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
  showHoverPreview = false,
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
  showHoverPreview?: boolean
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

  const hoverPreviewActive = showHoverPreview && value.trim() && !isActive

  const wrapHoverPreview = (control: ReactNode) => {
    if (!hoverPreviewActive) return control
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="w-full cursor-default">{control}</div>
        </HoverCardTrigger>
        <HoverCardContent
          side="left"
          align="start"
          sideOffset={8}
          className="pointer-events-none w-auto max-w-md max-h-80 overflow-y-auto border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-800 shadow-lg whitespace-pre-wrap"
        >
          {value}
        </HoverCardContent>
      </HoverCard>
    )
  }

  if (multiline) {
    return wrapHoverPreview(
      <textarea
        data-cell={cellId}
        value={value}
        rows={2}
        style={style}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onActivate}
        className={`${baseClass} resize-y leading-snug py-0.5 min-h-[2.25rem]`}
      />,
    )
  }

  return wrapHoverPreview(
    <input
      type="text"
      data-cell={cellId}
      value={value}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onActivate}
      className={`${baseClass} h-7 py-0 ${showHoverPreview ? "truncate" : ""}`}
    />,
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
const SERVER_SAVE_DEBOUNCE_MS = 500

type SaveStatus = "idle" | "saving" | "saved" | "error"

type StrategySyncTarget = {
  rowId: string
  beianHao: string
  productName: string
  level: 1 | 2 | 3
  levelLabel: string
  tableValue: string
  dbValue: string
}

function strategyLevelLabel(level: 1 | 2 | 3): string {
  return level === 1 ? "一级策略" : level === 2 ? "二级策略" : "三级策略"
}

function collectDdPersonnelOptions(rows: DueDiligenceTableRow[]): string[] {
  const names = new Set<string>()
  for (const row of rows) {
    const raw = row.ddPersonnel.trim()
    if (!raw) continue
    const parts = raw.split(/[、,，/|]/).map((part) => part.trim()).filter(Boolean)
    if (parts.length <= 1) {
      names.add(raw)
      continue
    }
    for (const part of parts) names.add(part)
    names.add(raw)
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"))
}

function StrategyCellContextMenu({
  row,
  level,
  onSyncRequest,
  children,
}: {
  row: DueDiligenceTableRow
  level: 1 | 2 | 3
  onSyncRequest: (row: DueDiligenceTableRow, level: 1 | 2 | 3) => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="w-full" onContextMenu={(e) => e.stopPropagation()}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          disabled={!row.representativeProductBeianHao}
          onClick={() => onSyncRequest(row, level)}
        >
          <Upload className="h-3.5 w-3.5" />
          同步标签到数据库
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function DdConclusionCellContextMenu({
  row,
  onEditRequest,
  children,
}: {
  row: DueDiligenceTableRow
  onEditRequest: (row: DueDiligenceTableRow) => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="w-full" onContextMenu={(e) => e.stopPropagation()}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-36">
        <ContextMenuItem onClick={() => onEditRequest(row)}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

type PerformanceFilterKind = "post-dd-up" | "post-dd-down" | "period-up" | "period-down"
type PerformanceFilter = {
  kind: PerformanceFilterKind
  periodStart?: string
  periodEnd?: string
} | null

function isoDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function performanceFilterLabel(filter: PerformanceFilter): string {
  if (!filter) return "业绩筛选"
  switch (filter.kind) {
    case "post-dd-up":
      return "尽调后上涨"
    case "post-dd-down":
      return "尽调后下跌"
    case "period-up":
      return `${filter.periodStart}~${filter.periodEnd} 上涨`
    case "period-down":
      return `${filter.periodStart}~${filter.periodEnd} 下跌`
  }
}

function rowMatchesPerformanceFilter(
  rowId: string,
  filter: PerformanceFilter,
  returns: Record<string, number | null>,
): boolean {
  if (!filter) return true
  const ret = returns[rowId]
  if (ret == null) return false
  if (filter.kind === "post-dd-up" || filter.kind === "period-up") return ret > 0
  return ret < 0
}

function ddTableUserHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  try {
    const raw = localStorage.getItem("currentUser")
    if (raw) {
      const user = JSON.parse(raw) as { id?: string; name?: string }
      if (user.id?.trim()) headers["x-market-user-id"] = user.id.trim()
      if (user.name?.trim()) headers["x-market-user-name"] = user.name.trim()
    }
  } catch {
    // ignore
  }
  return headers
}

// ── Main view ──────────────────────────────────────────────────────────────

export function DueDiligenceTableView() {
  const [rows, setRows] = useState<DueDiligenceTableRow[]>([])
  const [formats, setFormats] = useState<TableCellFormats>({})
  const [keyword, setKeyword] = useState("")
  const [performanceFilter, setPerformanceFilter] = useState<PerformanceFilter>(null)
  const [periodStartInput, setPeriodStartInput] = useState(() => isoDateDaysAgo(30))
  const [periodEndInput, setPeriodEndInput] = useState(() => todayIsoDate())
  const [rowReturns, setRowReturns] = useState<Record<string, number | null>>({})
  const [returnsLoading, setReturnsLoading] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selection, setSelection] = useState<SelectionState>({ kind: "none" })
  const [focusCell, setFocusCell] = useState<CellCoord | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])
  const [rowMenuDeleteCount, setRowMenuDeleteCount] = useState(1)
  const [isExtracting, setIsExtracting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null)
  const [teamStrategyTree, setTeamStrategyTree] = useState<TeamStrategyNode[]>([])
  const [poolMemberships, setPoolMemberships] = useState<Record<string, FundPoolMembership[]>>({})
  const [poolsLoading, setPoolsLoading] = useState(false)
  const [trackedMine, setTrackedMine] = useState<Set<string>>(new Set())
  const [trackedTeam, setTrackedTeam] = useState<Set<string>>(new Set())
  const [trackingDialogFund, setTrackingDialogFund] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [teamTrackingDialogFund, setTeamTrackingDialogFund] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [savedTeamStrategies, setSavedTeamStrategies] = useState<SavedTeamStrategiesMap>({})
  const [savedStrategiesLoading, setSavedStrategiesLoading] = useState(false)
  const [isImportingStrategies, setIsImportingStrategies] = useState(false)
  const [isSyncingStrategies, setIsSyncingStrategies] = useState(false)
  const [strategySyncTarget, setStrategySyncTarget] = useState<StrategySyncTarget | null>(null)
  const [isSyncingSingleStrategy, setIsSyncingSingleStrategy] = useState(false)
  const [showAddRecordDialog, setShowAddRecordDialog] = useState(false)
  const [ddConclusionEditTarget, setDdConclusionEditTarget] = useState<{
    rowId: string
    rowHint: string
  } | null>(null)
  const [ddConclusionDraft, setDdConclusionDraft] = useState("")
  const [materialsIndex, setMaterialsIndex] = useState<DdMaterialsFolderIndex | null>(null)
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const materialsAutoFillRef = useRef(false)
  const strategyMigrationRef = useRef(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ anchor: CellCoord; dragging: boolean } | null>(null)
  const rowMenuTargetRef = useRef<{ rowId: string; deleteIds: string[] }>({
    rowId: "",
    deleteIds: [],
  })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<{ rows: DueDiligenceTableRow[]; formats: TableCellFormats } | null>(null)
  const serverUpdatedAtRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)

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
      scheduleServerSave(next, formats)
    },
    [snapshot, formats],
  )

  const persistFormats = useCallback(
    (prevRows: DueDiligenceTableRow[], prevFormats: TableCellFormats, next: TableCellFormats) => {
      snapshot(prevRows, prevFormats)
      const pruned = pruneCellFormatsForRows(next, rows)
      setFormats(pruned)
      scheduleServerSave(rows, pruned)
    },
    [snapshot, rows],
  )

  const flushServerSave = useCallback(async () => {
    const pending = pendingSaveRef.current
    if (!pending || isSavingRef.current) return
    isSavingRef.current = true
    setSaveStatus("saving")
    setSaveError(null)
    try {
      const result = await saveDueDiligenceTableToServer(pending.rows, pending.formats)
      serverUpdatedAtRef.current = result.updatedAt
      setServerUpdatedAt(result.updatedAt)
      pendingSaveRef.current = null
      setSaveStatus("saved")
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败"
      setSaveError(message)
      setSaveStatus("error")
    } finally {
      isSavingRef.current = false
    }
  }, [])

  const scheduleServerSave = useCallback(
    (nextRows: DueDiligenceTableRow[], nextFormats: TableCellFormats) => {
      pendingSaveRef.current = { rows: nextRows, formats: nextFormats }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        void flushServerSave()
      }, SERVER_SAVE_DEBOUNCE_MS)
    },
    [flushServerSave],
  )

  const persistRowsChange = useCallback(
    (
      prevRows: DueDiligenceTableRow[],
      next: DueDiligenceTableRow[],
      prevFormats: TableCellFormats,
    ) => {
      snapshot(prevRows, prevFormats)
      const nextFormats = pruneCellFormatsForRows(prevFormats, next)
      setRows(next)
      setFormats(nextFormats)
      scheduleServerSave(next, nextFormats)
    },
    [snapshot, scheduleServerSave],
  )

  function undo() {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack
      const prev = stack[stack.length - 1]
      setRedoStack((r) => [{ rows, formats }, ...r.slice(0, MAX_HISTORY - 1)])
      setRows(prev.rows)
      setFormats(prev.formats)
      scheduleServerSave(prev.rows, prev.formats)
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
      scheduleServerSave(next.rows, next.formats)
      return stack.slice(1)
    })
  }

  // ── Load / server sync ──

  const applyServerData = useCallback(
    (data: { rows: DueDiligenceTableRow[]; formats: TableCellFormats; updatedAt: string }) => {
      const prunedFormats = pruneCellFormatsForRows(data.formats, data.rows)
      setRows(data.rows)
      setFormats(prunedFormats)
      serverUpdatedAtRef.current = data.updatedAt
      setServerUpdatedAt(data.updatedAt)
    },
    [],
  )

  const reload = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const data = await loadDueDiligenceTableFromServer()
      if (
        opts?.force ||
        !serverUpdatedAtRef.current ||
        data.updatedAt !== serverUpdatedAtRef.current
      ) {
        applyServerData(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败"
      setSaveError(message)
      setSaveStatus("error")
    }
  }, [applyServerData])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await reload()
      if (!cancelled) setHydrated(true)
    })()
    return () => { cancelled = true }
  }, [reload])

  useEffect(() => {
    let cancelled = false
    setMaterialsLoading(true)
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
      } finally {
        if (!cancelled) setMaterialsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rowMaterialsMap = useMemo(() => {
    if (!materialsIndex) {
      return new Map<string, { folderPath: string | null; folderName: string | null; documents: DdMaterialsDocument[] }>()
    }
    const map = new Map<string, { folderPath: string | null; folderName: string | null; documents: DdMaterialsDocument[] }>()
    for (const row of rows) {
      const folderPath = resolveDdMaterialsFolderPath(row, materialsIndex)
      const folderName = folderPath
        ? materialsIndex.folders.get(folderPath)?.name ?? folderPath.split("/").pop() ?? null
        : null
      map.set(row.id, {
        folderPath,
        folderName,
        documents: getDdMaterialsDocumentsForRow(row, materialsIndex),
      })
    }
    return map
  }, [materialsIndex, rows])

  useEffect(() => {
    if (!hydrated || !materialsIndex || materialsAutoFillRef.current) return

    let changed = false
    const nextRows = rows.map((row) => {
      const patch = buildDdMaterialsAutoFillPatch(row, materialsIndex)
      if (!patch) return row
      changed = true
      return { ...row, ...patch }
    })
    if (!changed) {
      materialsAutoFillRef.current = true
      return
    }
    materialsAutoFillRef.current = true
    persistRowsChange(rows, nextRows, formats)
  }, [hydrated, materialsIndex, rows, formats, persistRowsChange])

  useEffect(() => {
    let cancelled = false
    void loadTeamStrategyTree().then((tree) => {
      if (!cancelled) setTeamStrategyTree(tree)
    })
    return () => { cancelled = true }
  }, [])

  const linkedBeianHaos = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) {
      if (row.representativeProductBeianHao) set.add(row.representativeProductBeianHao)
    }
    return [...set]
  }, [rows])

  const refreshSavedTeamStrategies = useCallback(async () => {
    if (linkedBeianHaos.length === 0) {
      setSavedTeamStrategies({})
      return
    }
    setSavedStrategiesLoading(true)
    try {
      const strategies = await fetchSavedTeamStrategies(linkedBeianHaos)
      setSavedTeamStrategies(strategies)
    } catch {
      setSavedTeamStrategies({})
    } finally {
      setSavedStrategiesLoading(false)
    }
  }, [linkedBeianHaos])

  useEffect(() => {
    if (linkedBeianHaos.length === 0) {
      setSavedTeamStrategies({})
      return
    }
    let cancelled = false
    setSavedStrategiesLoading(true)
    void fetchSavedTeamStrategies(linkedBeianHaos)
      .then((strategies) => {
        if (!cancelled) setSavedTeamStrategies(strategies)
      })
      .catch(() => {
        if (!cancelled) setSavedTeamStrategies({})
      })
      .finally(() => {
        if (!cancelled) setSavedStrategiesLoading(false)
      })
    return () => { cancelled = true }
  }, [linkedBeianHaos])

  const refreshTrackedIds = useCallback(() => {
    fetch("/ma/api/tracking-funds/tracked-ids")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.mine)) setTrackedMine(new Set(d.mine))
        if (Array.isArray(d?.team)) setTrackedTeam(new Set(d.team))
      })
      .catch(() => {})
  }, [])

  const refreshPoolMemberships = useCallback(async (beians: string[]) => {
    if (beians.length === 0) {
      setPoolMemberships({})
      return
    }
    setPoolsLoading(true)
    try {
      const results = await Promise.all(
        beians.map(async (beian) => {
          const pools = await fetchFundPoolMemberships(beian)
          return [beian, pools] as const
        }),
      )
      setPoolMemberships(Object.fromEntries(results))
    } finally {
      setPoolsLoading(false)
    }
  }, [])

  const refreshTrackingData = useCallback(() => {
    refreshTrackedIds()
    void refreshPoolMemberships(linkedBeianHaos)
  }, [refreshTrackedIds, refreshPoolMemberships, linkedBeianHaos])

  useEffect(() => {
    refreshTrackedIds()
  }, [refreshTrackedIds])

  useEffect(() => {
    void refreshPoolMemberships(linkedBeianHaos)
  }, [linkedBeianHaos, refreshPoolMemberships])

  useEffect(() => {
    function onPoolChanged() {
      refreshTrackingData()
    }
    window.addEventListener("tracking-funds-pool-changed", onPoolChanged)
    return () => window.removeEventListener("tracking-funds-pool-changed", onPoolChanged)
  }, [refreshTrackingData])

  useEffect(() => {
    if (!hydrated || !teamStrategyTree.length || strategyMigrationRef.current || rows.length === 0) return

    let changed = false
    const migrated = rows.map((row) => {
      const next = migrateRowTeamStrategies(row, teamStrategyTree)
      if (
        next.strategyLevel1 !== row.strategyLevel1
        || next.strategyLevel2 !== row.strategyLevel2
        || next.strategyLevel3 !== row.strategyLevel3
      ) {
        changed = true
        return { ...row, ...next }
      }
      return row
    })

    strategyMigrationRef.current = true
    if (changed) {
      setRows(migrated)
      scheduleServerSave(migrated, formats)
    }
  }, [hydrated, teamStrategyTree, rows, formats, scheduleServerSave])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return
      if (focusCell || isDragging) return
      void reload()
    }
    function onFocus() {
      if (focusCell || isDragging) return
      void reload()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onFocus)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onFocus)
    }
  }, [reload, focusCell, isDragging])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (focusCell || isDragging || isSavingRef.current) return
      void reload()
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [reload, focusCell, isDragging])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      void flushServerSave()
    }
  }, [flushServerSave])

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

  useEffect(() => {
    if (!performanceFilter) {
      setRowReturns({})
      setReturnsLoading(false)
      return
    }

    let cancelled = false
    setReturnsLoading(true)

    const isPeriodFilter =
      performanceFilter.kind === "period-up"
      || performanceFilter.kind === "period-down"

    const items = rows.flatMap((row) => {
      const beian_hao = row.representativeProductBeianHao?.trim()
      if (!beian_hao) return []
      const dd_date = parseTableDate(row.ddDate)
      if (!isPeriodFilter && !dd_date) return []
      return [{
        row_id: row.id,
        beian_hao,
        product_name: row.representativeProduct.trim() || beian_hao,
        ...(dd_date ? { dd_date } : {}),
      }]
    })

    void (async () => {
      try {
        const body: Record<string, unknown> = { items }
        if (isPeriodFilter) {
          body.period_start = performanceFilter.periodStart
          body.period_end = performanceFilter.periodEnd
        }
        const res = await fetch("/ma/api/due-diligence-table/post-dd-returns", {
          method: "POST",
          headers: ddTableUserHeaders(),
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)
        setRowReturns(data.returns ?? {})
      } catch {
        if (!cancelled) setRowReturns({})
      } finally {
        if (!cancelled) setReturnsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rows, performanceFilter])

  function applyPeriodPerformanceFilter(kind: "period-up" | "period-down") {
    const periodStart = periodStartInput.trim()
    const periodEnd = periodEndInput.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return
    if (periodStart > periodEnd) return
    setPerformanceFilter({ kind, periodStart, periodEnd })
  }

  // ── Filtered rows ──

  const filteredRows = useMemo(() => {
    let filtered = rows.filter((row) => rowMatchesKeyword(row, keyword))
    if (performanceFilter) {
      filtered = filtered.filter((row) =>
        rowMatchesPerformanceFilter(row.id, performanceFilter, rowReturns),
      )
    }
    return sortDueDiligenceTableRowsByDateAsc(filtered)
  }, [rows, keyword, performanceFilter, rowReturns])

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

  const selectedRowActionIds = useMemo(
    () => selectedRowIdsFromSelection(selection, rows),
    [selection, rows],
  )

  function getStrategyActionTargetRows(): DueDiligenceTableRow[] {
    const withProduct = (row: DueDiligenceTableRow) => Boolean(row.representativeProductBeianHao)
    if (selectedRowActionIds.length > 0) {
      const idSet = new Set(selectedRowActionIds)
      return rows.filter((row) => idSet.has(row.id) && withProduct(row))
    }
    return rows.filter(withProduct)
  }

  function getRowSavedStrategy(row: DueDiligenceTableRow) {
    const beian = row.representativeProductBeianHao
    if (!beian) return undefined
    return savedTeamStrategies[beian]
  }

  function getStrategyMatchStatusForCell(
    row: DueDiligenceTableRow,
    level: 1 | 2 | 3,
  ): "match" | "mismatch" | "none" {
    const saved = getRowSavedStrategy(row)
    if (!saved || !hasSavedTeamStrategy(saved)) return "none"
    const tableValue =
      level === 1 ? row.strategyLevel1 : level === 2 ? row.strategyLevel2 : row.strategyLevel3
    const savedValue =
      level === 1 ? saved.strategy_l1 : level === 2 ? saved.strategy_l2 : saved.strategy_l3
    if (level === 3) {
      return getStrategyLevel3MatchStatus(tableValue, savedValue, Boolean(savedValue))
    }
    return getStrategyCellMatchStatus(tableValue, savedValue, Boolean(savedValue))
  }

  function getSavedStrategyValueForCell(
    row: DueDiligenceTableRow,
    level: 1 | 2 | 3,
  ): string | undefined {
    const saved = getRowSavedStrategy(row)
    if (!saved) return undefined
    return level === 1 ? saved.strategy_l1 : level === 2 ? saved.strategy_l2 : saved.strategy_l3
  }

  async function handleImportTeamStrategies() {
    if (isImportingStrategies) return
    const targetRows = getStrategyActionTargetRows()
    if (targetRows.length === 0) {
      alert("请先为行关联代表产品（备案编码），或选中含代表产品的行。")
      return
    }

    setIsImportingStrategies(true)
    try {
      const strategies = await fetchSavedTeamStrategies(
        targetRows.map((row) => row.representativeProductBeianHao!),
      )
      setSavedTeamStrategies((prev) => ({ ...prev, ...strategies }))

      let updated = 0
      let skipped = 0
      const nextRows = rows.map((row) => {
        const beian = row.representativeProductBeianHao
        const isTarget = targetRows.some((target) => target.id === row.id)
        if (!isTarget || !beian) return row

        const saved = strategies[beian]
        if (!hasSavedTeamStrategy(saved)) {
          skipped += 1
          return row
        }

        const migrated = migrateRowTeamStrategies(
          {
            strategyLevel1: saved!.strategy_l1,
            strategyLevel2: saved!.strategy_l2,
            strategyLevel3: strategyLevel3FromDatabase(saved!.strategy_l3),
          },
          teamStrategyTree,
        )
        if (
          migrated.strategyLevel1 === row.strategyLevel1
          && migrated.strategyLevel2 === row.strategyLevel2
          && migrated.strategyLevel3 === row.strategyLevel3
        ) {
          skipped += 1
          return row
        }

        updated += 1
        return {
          ...row,
          strategyLevel1: migrated.strategyLevel1,
          strategyLevel2: migrated.strategyLevel2,
          strategyLevel3: migrated.strategyLevel3,
        }
      })

      if (updated === 0) {
        alert(
          skipped > 0
            ? "所选行在数据库中暂无团队策略标签，或表格已与数据库一致。"
            : "没有可提取的团队策略标签。",
        )
        return
      }

      persistRowsChange(rows, nextRows, formats)
      alert(`已提取 ${updated} 行的团队策略标签${skipped > 0 ? `，${skipped} 行跳过` : ""}。`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "提取失败"
      alert(`提取团队策略标签失败：${message}`)
    } finally {
      setIsImportingStrategies(false)
    }
  }

  async function handleSyncTeamStrategies() {
    if (isSyncingStrategies) return
    const targetRows = getStrategyActionTargetRows().filter(rowHasAnyTableStrategy)
    if (targetRows.length === 0) {
      alert("请先选择含代表产品且已填写策略标签的行。")
      return
    }

    const msg = selectedRowActionIds.length > 0
      ? `将选中的 ${targetRows.length} 行策略标签同步到数据库中的团队策略，是否继续？`
      : `将 ${targetRows.length} 行（已关联代表产品）的策略标签同步到数据库，是否继续？`
    if (!window.confirm(msg)) return

    setIsSyncingStrategies(true)
    try {
      const updates = [...new Map(
        targetRows.map((row) => [
          row.representativeProductBeianHao!,
          {
            beian_hao: row.representativeProductBeianHao!,
            strategy_l1: row.strategyLevel1.trim(),
            strategy_l2: row.strategyLevel2.trim(),
            strategy_l3: strategyLevel3ForDatabase(row.strategyLevel3),
          },
        ]),
      ).values()]
      const { updated } = await syncTeamStrategiesToDatabase(updates)
      await refreshSavedTeamStrategies()
      alert(`同步完成：已更新 ${updated} 个产品的团队策略标签。`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败"
      alert(`同步团队策略标签失败：${message}`)
    } finally {
      setIsSyncingStrategies(false)
    }
  }

  function openStrategySyncConfirm(row: DueDiligenceTableRow, level: 1 | 2 | 3) {
    const beian = row.representativeProductBeianHao
    if (!beian) {
      alert("请先关联代表产品（备案编码）。")
      return
    }
    const tableValue =
      level === 1 ? row.strategyLevel1 : level === 2 ? row.strategyLevel2 : row.strategyLevel3
    setStrategySyncTarget({
      rowId: row.id,
      beianHao: beian,
      productName: row.representativeProduct.trim() || beian,
      level,
      levelLabel: strategyLevelLabel(level),
      tableValue: tableValue.trim(),
      dbValue: (getSavedStrategyValueForCell(row, level) ?? "").trim(),
    })
  }

  async function confirmStrategySync() {
    if (!strategySyncTarget || isSyncingSingleStrategy) return
    const row = rows.find((item) => item.id === strategySyncTarget.rowId)
    if (!row) {
      setStrategySyncTarget(null)
      return
    }

    setIsSyncingSingleStrategy(true)
    try {
      const saved = getRowSavedStrategy(row)
      const { level, beianHao, levelLabel } = strategySyncTarget
      const update = {
        beian_hao: beianHao,
        strategy_l1:
          level === 1
            ? row.strategyLevel1.trim()
            : (saved?.strategy_l1 ?? row.strategyLevel1.trim()),
        strategy_l2:
          level === 2
            ? row.strategyLevel2.trim()
            : (saved?.strategy_l2 ?? row.strategyLevel2.trim()),
        strategy_l3:
          level === 3
            ? strategyLevel3ForDatabase(row.strategyLevel3)
            : (saved?.strategy_l3 ?? strategyLevel3ForDatabase(row.strategyLevel3)),
      }
      await syncTeamStrategiesToDatabase([update])
      await refreshSavedTeamStrategies()
      setStrategySyncTarget(null)
      alert(`已同步${levelLabel}到数据库。`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败"
      alert(`同步团队策略标签失败：${message}`)
    } finally {
      setIsSyncingSingleStrategy(false)
    }
  }

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
    const skipPreventDefault =
      colKey === "ddDate" ||
      colKey === "ddTime" ||
      colKey === "ddMethod" ||
      colKey === "strategyLevel1" ||
      colKey === "strategyLevel2" ||
      colKey === "strategyLevel3" ||
      colKey === "ddMaterials"
    if (!skipPreventDefault) {
      e.preventDefault()
    }
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
      const colKey = drag.anchor.colKey
      const skipAutoFocus =
        colKey === "ddDate" ||
        colKey === "ddTime" ||
        colKey === "ddMethod" ||
        colKey === "strategyLevel1" ||
        colKey === "strategyLevel2" ||
        colKey === "strategyLevel3"
      if (!drag.dragging && !skipAutoFocus) {
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

  function handleDdMaterialsLinkPatch(
    rowId: string,
    patch: Parameters<typeof updateDueDiligenceTableRow>[2],
  ) {
    const next = updateDueDiligenceTableRow(rows, rowId, patch)
    persistRows(rows, next, formats)
  }

  function openDdConclusionEditor(row: DueDiligenceTableRow) {
    const rowHint =
      row.ddTarget.trim()
      || row.representativeProduct.trim()
      || row.fundCompany.trim()
      || "该行"
    setDdConclusionDraft(row.ddConclusion)
    setDdConclusionEditTarget({ rowId: row.id, rowHint })
    setFocusCell({ rowId: row.id, colKey: "ddConclusion" })
    setSelection({
      kind: "range",
      anchor: { rowId: row.id, colKey: "ddConclusion" },
      focus: { rowId: row.id, colKey: "ddConclusion" },
    })
  }

  function saveDdConclusionEditor() {
    if (!ddConclusionEditTarget) return
    handleCellChange(ddConclusionEditTarget.rowId, "ddConclusion", ddConclusionDraft)
    setDdConclusionEditTarget(null)
    setDdConclusionDraft("")
  }

  function handleStrategyChange(
    rowId: string,
    level: 1 | 2 | 3,
    value: string,
  ) {
    if (level === 1) {
      const next = updateDueDiligenceTableRow(rows, rowId, {
        strategyLevel1: value,
        strategyLevel2: "",
        strategyLevel3: "",
      })
      persistRows(rows, next, formats)
      return
    }
    if (level === 2) {
      const next = updateDueDiligenceTableRow(rows, rowId, {
        strategyLevel2: value,
        strategyLevel3: "",
      })
      persistRows(rows, next, formats)
      return
    }
    handleCellChange(rowId, "strategyLevel3", value)
  }

  const teamL1Options = useMemo(
    () => teamStrategyL1Options(teamStrategyTree),
    [teamStrategyTree],
  )

  const personnelOptions = useMemo(
    () => collectDdPersonnelOptions(rows),
    [rows],
  )

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

  function handleAddRecordSubmit(form: DueDiligenceTableRecordForm) {
    const { data, representativeProductBeianHao } = recordFormToRowData(form)
    const newRow = createDueDiligenceTableRow(data)
    if (representativeProductBeianHao) {
      newRow.representativeProductBeianHao = representativeProductBeianHao
    }
    persistRowsChange(rows, [newRow, ...rows], formats)
    setSelection({ kind: "rows", rowIds: [newRow.id] })
  }

  function handleRowContextMenu(rowId: string) {
    const deleteIds =
      selection.kind === "rows" && selection.rowIds.includes(rowId)
        ? selection.rowIds
        : [rowId]
    rowMenuTargetRef.current = { rowId, deleteIds }
    setRowMenuDeleteCount(deleteIds.length)
    if (!(selection.kind === "rows" && selection.rowIds.includes(rowId))) {
      setSelection({ kind: "rows", rowIds: [rowId] })
    }
  }

  function handleInsertRows(rowId: string, position: "above" | "below", count = 1) {
    const index = rows.findIndex((row) => row.id === rowId)
    if (index < 0) return
    const nextRows = insertDueDiligenceTableRowsAt(rows, rowId, position, count)
    persistRowsChange(rows, nextRows, formats)
    const insertIndex = position === "above" ? index : index + 1
    const newRowIds = nextRows.slice(insertIndex, insertIndex + count).map((row) => row.id)
    setSelection({ kind: "rows", rowIds: newRowIds })
  }

  function handleInsertAboveSelected() {
    const rowIds = selectedRowIdsFromSelection(selection, rows)
    const anchorId = primaryRowId(rowIds, rows)
    if (!anchorId) return
    handleInsertRows(anchorId, "above")
  }

  function handleInsertBelowSelected() {
    const rowIds = selectedRowIdsFromSelection(selection, rows)
    const anchorId = primaryRowId(rowIds, rows)
    if (!anchorId) return
    handleInsertRows(anchorId, "below")
  }

  function handleDeleteRows(rowIds: string[]) {
    if (rowIds.length === 0) return
    const msg =
      rowIds.length === 1
        ? "确定删除该行？"
        : `确定删除选中的 ${rowIds.length} 行？`
    if (!window.confirm(msg)) return
    const nextRows = deleteDueDiligenceTableRows(rows, rowIds)
    persistRowsChange(rows, nextRows, formats)
    setSelection({ kind: "none" })
    setFocusCell(null)
  }

  function handleDeleteSelectedRows() {
    handleDeleteRows(selectedRowIdsFromSelection(selection, rows))
  }

  function handleResetSeed() {
    if (!window.confirm("将用初始 Excel 数据覆盖当前表格，是否继续？")) return
    const next = resetDueDiligenceTableFromSeed()
    snapshot(rows, formats)
    setRows(next)
    setFormats({})
    scheduleServerSave(next, {})
  }

  async function handleExtractToCalendar() {
    if (isExtracting) return
    let existingSchedules: DueDiligenceSchedule[] = []
    try {
      existingSchedules = await loadDueDiligenceSchedulesFromServer()
    } catch {
      const { loadDueDiligenceSchedules } = await import("@/lib/ma/due-diligence-schedules")
      existingSchedules = loadDueDiligenceSchedules()
    }

    const { withDate, alreadySynced } = countExtractableRows(rows, existingSchedules)
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

    setIsExtracting(true)
    try {
      const pendingRows = rowsPendingCalendarSync(rows, existingSchedules)
      const result = extractTableRowsToCalendar(rows, existingSchedules)
      await saveDueDiligenceSchedulesToServer(result.schedules)
      const addedDates = pendingRows
        .map((row) => parseTableDate(row.ddDate)!)
        .sort()
      const monthHint =
        addedDates.length > 0
          ? `记录主要在 ${addedDates[0].slice(0, 4)}年${Number(addedDates[0].slice(5, 7))}月，请在日历中切换月份查看。`
          : "请到左侧「尽调日历」查看。"
      alert(
        `提取完成：新增 ${result.added} 条${result.skipped > 0 ? `，跳过 ${result.skipped} 条（已同步）` : ""}。${monthHint}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "提取失败"
      alert(`提取失败：${message}`)
    } finally {
      setIsExtracting(false)
    }
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
            <p className="mt-0.5 text-xs text-zinc-500">
              团队协作收集尽调信息，可直接在单元格中编辑。
              <span className="ml-2 text-emerald-700">绿色</span>
              <span>=与数据库一致，</span>
              <span className="text-amber-700">黄色</span>
              <span>=与数据库不一致</span>
              {saveStatus === "saving" && <span className="ml-2 text-amber-600">保存中…</span>}
              {saveStatus === "saved" && <span className="ml-2 text-emerald-600">已保存到团队</span>}
              {saveStatus === "error" && (
                <span className="ml-2 text-red-600">
                  保存失败{saveError ? `：${saveError}` : "，请检查网络"}
                </span>
              )}
            </p>
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
            <button type="button" onClick={() => void handleExtractToCalendar()} disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50">
              <CalendarDays className="h-3.5 w-3.5" />{isExtracting ? "提取中…" : "提取到尽调日历"}
            </button>
            <button
              type="button"
              onClick={() => void handleImportTeamStrategies()}
              disabled={isImportingStrategies || savedStrategiesLoading}
              title="从数据库读取代表产品的团队策略标签并填入表格"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {isImportingStrategies ? "提取中…" : "提取团队策略标签"}
            </button>
            <button
              type="button"
              onClick={() => void handleSyncTeamStrategies()}
              disabled={isSyncingStrategies}
              title="将表格中的策略标签同步到数据库"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {isSyncingStrategies ? "同步中…" : "从团队策略提取标签"}
            </button>
            <button type="button" onClick={handleResetSeed}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" />恢复初始数据
            </button>
            <button type="button" onClick={() => setShowAddRecordDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors">
              <Plus className="h-3.5 w-3.5" />添加记录
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input type="search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索基金公司、经理、策略、结论…"
                className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100" />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={[
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors whitespace-nowrap",
                    performanceFilter
                      ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {performanceFilter ? performanceFilterLabel(performanceFilter) : "业绩筛选"}
                  {returnsLoading && <span className="text-zinc-400">…</span>}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 text-xs">
                <DropdownMenuItem
                  onClick={() => setPerformanceFilter(null)}
                  className={!performanceFilter ? "font-medium text-red-600" : ""}
                >
                  全部
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setPerformanceFilter({ kind: "post-dd-up" })}
                  className={performanceFilter?.kind === "post-dd-up" ? "font-medium text-red-600" : ""}
                >
                  尽调后上涨
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPerformanceFilter({ kind: "post-dd-down" })}
                  className={performanceFilter?.kind === "post-dd-down" ? "font-medium text-red-600" : ""}
                >
                  尽调后下跌
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div
                  className="px-2 py-1.5"
                  onPointerDown={(e) => e.preventDefault()}
                >
                  <div className="mb-1.5 text-[11px] text-zinc-500">指定区间</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-8 shrink-0 text-zinc-500">起始</span>
                      <input
                        type="date"
                        value={periodStartInput}
                        onChange={(e) => setPeriodStartInput(e.target.value)}
                        className="h-7 min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-8 shrink-0 text-zinc-500">结束</span>
                      <input
                        type="date"
                        value={periodEndInput}
                        onChange={(e) => setPeriodEndInput(e.target.value)}
                        className="h-7 min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100"
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => applyPeriodPerformanceFilter("period-up")}
                      className={[
                        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                        performanceFilter?.kind === "period-up"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                      ].join(" ")}
                    >
                      区间上涨
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPeriodPerformanceFilter("period-down")}
                      className={[
                        "flex-1 rounded border px-2 py-1 text-xs transition-colors",
                        performanceFilter?.kind === "period-down"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                      ].join(" ")}
                    >
                      区间下跌
                    </button>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
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
              共 {filteredRows.length} 条
              {(keyword.trim() || performanceFilter) ? ` / ${rows.length} 总计` : ""}
              {returnsLoading ? " · 计算业绩中…" : ""}
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
        rowActions={
          selectedRowActionIds.length > 0
            ? {
                count: selectedRowActionIds.length,
                onInsertAbove: handleInsertAboveSelected,
                onInsertBelow: handleInsertBelowSelected,
                onDelete: handleDeleteSelectedRows,
              }
            : undefined
        }
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
                  onClick={() => handleResetSeed()}
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
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger asChild>
                    <tr
                      className="group hover:bg-red-50/30"
                      onContextMenu={() => handleRowContextMenu(row.id)}
                    >
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
                              ddDate={row.ddDate}
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
                          ) : col.key === "ddDate" ? (
                            <DdDateCell
                              cellId={cellId}
                              value={row.ddDate}
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
                              onChange={(value) => handleCellChange(row.id, col.key, value)}
                            />
                          ) : col.key === "ddTime" ? (
                            <DdSelectCell
                              cellId={cellId}
                              value={row.ddTime}
                              width={col.width}
                              format={fmt}
                              isActive={isActive}
                              isSelected={isSelected}
                              options={buildDdTimeOptions(row.ddTime)}
                              placeholder="时间"
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
                          ) : col.key === "ddMethod" ? (
                            <DdSelectCell
                              cellId={cellId}
                              value={row.ddMethod}
                              width={col.width}
                              format={fmt}
                              isActive={isActive}
                              isSelected={isSelected}
                              options={[...DD_METHOD_OPTIONS]}
                              placeholder="尽调形式"
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
                          ) : col.key === "strategyLevel1" ? (
                            <StrategyCellContextMenu
                              row={row}
                              level={1}
                              onSyncRequest={openStrategySyncConfirm}
                            >
                              <StrategySelectCell
                                cellId={cellId}
                                value={row.strategyLevel1}
                                width={col.width}
                                format={fmt}
                                isActive={isActive}
                                isSelected={isSelected}
                                options={teamL1Options}
                                placeholder="一级策略"
                                disabled={teamL1Options.length === 0}
                                matchStatus={getStrategyMatchStatusForCell(row, 1)}
                                dbValue={getSavedStrategyValueForCell(row, 1)}
                                levelLabel="一级策略"
                                onActivate={() => {
                                  setFocusCell({ rowId: row.id, colKey: col.key })
                                  setSelection({
                                    kind: "range",
                                    anchor: { rowId: row.id, colKey: col.key },
                                    focus: { rowId: row.id, colKey: col.key },
                                  })
                                }}
                                onChange={(value) => handleStrategyChange(row.id, 1, value)}
                              />
                            </StrategyCellContextMenu>
                          ) : col.key === "strategyLevel2" ? (
                            <StrategyCellContextMenu
                              row={row}
                              level={2}
                              onSyncRequest={openStrategySyncConfirm}
                            >
                              <StrategySelectCell
                                cellId={cellId}
                                value={row.strategyLevel2}
                                width={col.width}
                                format={fmt}
                                isActive={isActive}
                                isSelected={isSelected}
                                options={teamStrategyL2Options(teamStrategyTree, row.strategyLevel1)}
                                placeholder={row.strategyLevel1 ? "二级策略" : "先选一级"}
                                disabled={!row.strategyLevel1}
                                matchStatus={getStrategyMatchStatusForCell(row, 2)}
                                dbValue={getSavedStrategyValueForCell(row, 2)}
                                levelLabel="二级策略"
                                onActivate={() => {
                                  setFocusCell({ rowId: row.id, colKey: col.key })
                                  setSelection({
                                    kind: "range",
                                    anchor: { rowId: row.id, colKey: col.key },
                                    focus: { rowId: row.id, colKey: col.key },
                                  })
                                }}
                                onChange={(value) => handleStrategyChange(row.id, 2, value)}
                              />
                            </StrategyCellContextMenu>
                          ) : col.key === "strategyLevel3" ? (
                            <StrategyCellContextMenu
                              row={row}
                              level={3}
                              onSyncRequest={openStrategySyncConfirm}
                            >
                              <StrategyMultiSelectCell
                                cellId={cellId}
                                value={row.strategyLevel3}
                                width={col.width}
                                format={fmt}
                                isActive={isActive}
                                isSelected={isSelected}
                                options={teamStrategyL3Options(
                                  teamStrategyTree,
                                  row.strategyLevel1,
                                  row.strategyLevel2,
                                )}
                                placeholder={
                                  !row.strategyLevel1
                                    ? "先选一级"
                                    : !row.strategyLevel2
                                      ? "先选二级"
                                      : "三级策略"
                                }
                                disabled={!row.strategyLevel1 || !row.strategyLevel2}
                                matchStatus={getStrategyMatchStatusForCell(row, 3)}
                                dbValue={getSavedStrategyValueForCell(row, 3)}
                                levelLabel="三级策略"
                                onActivate={() => {
                                  setFocusCell({ rowId: row.id, colKey: col.key })
                                  setSelection({
                                    kind: "range",
                                    anchor: { rowId: row.id, colKey: col.key },
                                    focus: { rowId: row.id, colKey: col.key },
                                  })
                                }}
                                onChange={(value) => handleStrategyChange(row.id, 3, value)}
                              />
                            </StrategyCellContextMenu>
                          ) : col.key === "inTrackingPool" ? (
                            (() => {
                              const beian = row.representativeProductBeianHao
                              const allPools = beian ? (poolMemberships[beian] ?? []) : []
                              const { teamPools } = splitFundPoolMemberships(allPools)
                              return (
                                <TrackingPoolsCell
                                  pools={teamPools}
                                  loading={
                                    Boolean(beian)
                                    && poolsLoading
                                    && beian != null
                                    && !(beian in poolMemberships)
                                  }
                                  width={col.width}
                                />
                              )
                            })()
                          ) : col.key === "ddMaterials" ? (
                            (() => {
                              const materials = rowMaterialsMap.get(row.id)
                              return (
                                <DdMaterialsCell
                                  cellId={cellId}
                                  value={row.ddMaterials}
                                  width={col.width}
                                  format={fmt}
                                  isActive={isActive}
                                  isSelected={isSelected}
                                  folderPath={materials?.folderPath ?? null}
                                  folderName={materials?.folderName ?? null}
                                  documents={materials?.documents ?? []}
                                  materialsLoading={materialsLoading}
                                  linkStatus={row.ddMaterialsLinkStatus}
                                  fileLinks={row.ddMaterialsFileLinks}
                                  onActivate={() => {
                                    setFocusCell({ rowId: row.id, colKey: col.key })
                                    setSelection({
                                      kind: "range",
                                      anchor: { rowId: row.id, colKey: col.key },
                                      focus: { rowId: row.id, colKey: col.key },
                                    })
                                  }}
                                  onChange={(value) => handleCellChange(row.id, col.key, value)}
                                  onManualLink={(kbPath) => {
                                    handleDdMaterialsLinkPatch(row.id, {
                                      ddMaterials: "已上传",
                                      ddMaterialsKbPath: kbPath,
                                      ddMaterialsLinkStatus: "manual",
                                      ddMaterialsFileLinks: null,
                                    })
                                  }}
                                  onApproveLink={() => {
                                    handleDdMaterialsLinkPatch(row.id, {
                                      ddMaterials: "已上传",
                                      ddMaterialsLinkStatus: "approved",
                                    })
                                  }}
                                  onRejectLink={() => {
                                    handleDdMaterialsLinkPatch(row.id, {
                                      ddMaterials: "",
                                      ddMaterialsKbPath: null,
                                      ddMaterialsLinkStatus: "rejected",
                                      ddMaterialsFileLinks: null,
                                    })
                                  }}
                                  onApproveFiles={(paths) => {
                                    const patch: Partial<Record<string, "approved" | "rejected">> = {}
                                    for (const path of paths) patch[path] = "approved"
                                    handleDdMaterialsLinkPatch(row.id, { ddMaterialsFileLinks: patch })
                                  }}
                                  onRejectFiles={(paths) => {
                                    const patch: Partial<Record<string, "approved" | "rejected">> = {}
                                    for (const path of paths) patch[path] = "rejected"
                                    handleDdMaterialsLinkPatch(row.id, { ddMaterialsFileLinks: patch })
                                  }}
                                />
                              )
                            })()
                          ) : col.key === "ddConclusion" ? (
                            <DdConclusionCellContextMenu
                              row={row}
                              onEditRequest={openDdConclusionEditor}
                            >
                              <EditableCell
                                cellId={cellId}
                                value={row.ddConclusion}
                                width={col.width}
                                multiline={col.multiline}
                                format={fmt}
                                isActive={isActive}
                                isSelected={isSelected}
                                showHoverPreview={col.hoverPreview}
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
                            </DdConclusionCellContextMenu>
                          ) : (
                            <EditableCell
                              cellId={cellId}
                              value={row[col.key]}
                              width={col.width}
                              multiline={col.multiline}
                              format={fmt}
                              isActive={isActive}
                              isSelected={isSelected}
                              showHoverPreview={col.hoverPreview}
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
                    <td
                      className="border-b border-zinc-100 py-0.5 text-center align-top"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const beian = row.representativeProductBeianHao
                        const productName = row.representativeProduct.trim() || beian || ""
                        const canTrack = Boolean(beian && productName)
                        const allPools = beian ? (poolMemberships[beian] ?? []) : []
                        const poolsReady = Boolean(beian && beian in poolMemberships)
                        const { inMine, inTeam } = splitFundPoolMemberships(allPools)
                        const heartTracked = poolsReady ? inMine : (beian ? trackedMine.has(beian) : false)
                        const teamTracked = poolsReady ? inTeam : (beian ? trackedTeam.has(beian) : false)
                        return (
                          <div
                            className={[
                              "flex items-center justify-center gap-0.5",
                              canTrack ? "" : "opacity-40 pointer-events-none",
                            ].join(" ")}
                            title={canTrack ? undefined : "请先关联代表产品"}
                          >
                            <AddToTrackingButton
                              isTracked={heartTracked}
                              onClick={() => {
                                if (!beian) return
                                setTrackingDialogFund({ beian_hao: beian, product_name: productName })
                              }}
                            />
                            <AddToTeamTrackingButton
                              isTracked={teamTracked}
                              onClick={() => {
                                if (!beian) return
                                setTeamTrackingDialogFund({ beian_hao: beian, product_name: productName })
                              }}
                            />
                          </div>
                        )
                      })()}
                    </td>
                    </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-40">
                        <ContextMenuItem onClick={() => handleInsertRows(row.id, "above")}>
                          <Plus className="h-3.5 w-3.5" />
                          在上方插入行
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleInsertRows(row.id, "below")}>
                          <Plus className="h-3.5 w-3.5" />
                          在下方插入行
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => handleDeleteRows(rowMenuTargetRef.current.deleteIds)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {rowMenuDeleteCount > 1
                            ? `删除 ${rowMenuDeleteCount} 行`
                            : "删除行"}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {trackingDialogFund && (
        <AddMyTrackingDialog
          open
          beian_hao={trackingDialogFund.beian_hao}
          product_name={trackingDialogFund.product_name}
          onClose={() => setTrackingDialogFund(null)}
          onSaved={refreshTrackingData}
        />
      )}
      {teamTrackingDialogFund && (
        <AddToTeamTrackingDialog
          open
          beian_hao={teamTrackingDialogFund.beian_hao}
          product_name={teamTrackingDialogFund.product_name}
          onClose={() => setTeamTrackingDialogFund(null)}
          onSaved={refreshTrackingData}
        />
      )}
      <AlertDialog
        open={strategySyncTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isSyncingSingleStrategy) setStrategySyncTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同步标签到数据库</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  此操作将用表格中的值
                  <span className="font-medium text-foreground">覆盖</span>
                  数据库中「{strategySyncTarget?.productName}」的
                  {strategySyncTarget?.levelLabel}。
                </p>
                <div className="rounded-md border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-xs leading-relaxed text-zinc-700">
                  <p>
                    <span className="text-zinc-500">表格当前值：</span>
                    {strategySyncTarget?.tableValue || "（空）"}
                  </p>
                  <p className="mt-1">
                    <span className="text-zinc-500">数据库当前值：</span>
                    {strategySyncTarget?.dbValue || "（空）"}
                  </p>
                </div>
                <p>确认继续？</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSyncingSingleStrategy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSyncingSingleStrategy}
              onClick={(e) => {
                e.preventDefault()
                void confirmStrategySync()
              }}
            >
              {isSyncingSingleStrategy ? "同步中…" : "确认覆盖"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AddDueDiligenceRecordDialog
        open={showAddRecordDialog}
        onOpenChange={setShowAddRecordDialog}
        onSubmit={handleAddRecordSubmit}
        teamStrategyTree={teamStrategyTree}
        personnelOptions={personnelOptions}
      />
      <Dialog
        open={ddConclusionEditTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDdConclusionEditTarget(null)
            setDdConclusionDraft("")
          }
        }}
      >
        <DialogContent className="max-w-2xl gap-0 p-0" showCloseButton>
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="text-base font-semibold">编辑尽调结论</DialogTitle>
            {ddConclusionEditTarget && (
              <p className="mt-1 text-xs text-zinc-500">
                {ddConclusionEditTarget.rowHint}
              </p>
            )}
          </DialogHeader>
          <div className="px-6 py-5">
            <textarea
              value={ddConclusionDraft}
              onChange={(e) => setDdConclusionDraft(e.target.value)}
              rows={12}
              autoFocus
              placeholder="请输入尽调结论…"
              className="min-h-[18rem] w-full resize-y rounded border border-zinc-200 px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-200"
            />
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <button
              type="button"
              onClick={() => {
                setDdConclusionEditTarget(null)
                setDdConclusionDraft("")
              }}
              className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveDdConclusionEditor}
              className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600"
            >
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
