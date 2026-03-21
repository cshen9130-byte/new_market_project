"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Database, TableIcon, ChevronRight, Download, Play, RefreshCw,
  AlertCircle, CheckCircle2, Clock, Rows3, ArrowLeft, ArrowRight,
  ChevronsLeft, ChevronsRight,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

type TableMeta = {
  table_name: string
  table_type: string
  row_estimate: string
}

type ColumnMeta = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

type IndexMeta = {
  indexname: string
  indexdef: string
}

type QueryResult = {
  rows: Record<string, unknown>[]
  columns: string[]
  rowCount: number
  elapsed: number
  command: string
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

function downloadCsv(columns: string[], rows: Record<string, unknown>[], filename = "export.csv") {
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v)
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [
    columns.map(escape).join(","),
    ...rows.map(r => columns.map(c => escape(r[c])).join(",")),
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadJson(data: unknown, filename = "export.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const PAGE_SIZE = 100

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DbExplorerPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  // Tables list
  const [tables, setTables] = useState<TableMeta[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tableFilter, setTableFilter] = useState("")

  // Selected table
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnMeta[]>([])
  const [indexes, setIndexes] = useState<IndexMeta[]>([])
  const [schemaLoading, setSchemaLoading] = useState(false)

  // Preview data
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([])
  const [previewCols, setPreviewCols] = useState<string[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [previewPage, setPreviewPage] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)

  // SQL editor
  const [sql, setSql] = useState("")
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const sqlRef = useRef<HTMLTextAreaElement>(null)

  // Export full table
  const [exportLoading, setExportLoading] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const user = authService.getCurrentUser()
    if (!user || user.name !== "cshen") {
      setAuthorized(false)
      return
    }
    setAuthorized(true)
    loadTables()
  }, [])

  // ── API helpers ──────────────────────────────────────────────────────────

  async function apiFetch(url: string) {
    const res = await fetch(url, { headers: { ...getAuthHeaders() } })
    return res.json()
  }

  async function loadTables() {
    setTablesLoading(true)
    try {
      const data = await apiFetch("/api/db-explorer?action=list_tables")
      if (data.ok) setTables(data.tables ?? [])
    } finally {
      setTablesLoading(false)
    }
  }

  const loadSchema = useCallback(async (tableName: string) => {
    setSchemaLoading(true)
    try {
      const data = await apiFetch(`/api/db-explorer?action=describe_table&table=${encodeURIComponent(tableName)}`)
      if (data.ok) {
        setColumns(data.columns ?? [])
        setIndexes(data.indexes ?? [])
      }
    } finally {
      setSchemaLoading(false)
    }
  }, [])

  const loadPreview = useCallback(async (tableName: string, page: number) => {
    setPreviewLoading(true)
    try {
      const offset = page * PAGE_SIZE
      const data = await apiFetch(
        `/api/db-explorer?action=preview&table=${encodeURIComponent(tableName)}&limit=${PAGE_SIZE}&offset=${offset}`,
      )
      if (data.ok) {
        setPreviewRows(data.rows ?? [])
        setPreviewCols(data.columns ?? [])
        setPreviewTotal(data.total ?? 0)
      }
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  async function selectTable(name: string) {
    setSelectedTable(name)
    setPreviewPage(0)
    setSql(`SELECT * FROM "${name}" LIMIT 100;`)
    await Promise.all([loadSchema(name), loadPreview(name, 0)])
  }

  async function handlePreviewPage(next: number) {
    if (!selectedTable) return
    setPreviewPage(next)
    await loadPreview(selectedTable, next)
  }

  async function exportTable() {
    if (!selectedTable) return
    setExportLoading(true)
    try {
      const res = await fetch(
        `/api/db-explorer?action=export_table&table=${encodeURIComponent(selectedTable)}`,
        { headers: { ...getAuthHeaders() } },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || "导出失败")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${selectedTable}_full.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportLoading(false)
    }
  }

  async function runQuery() {
    if (!sql.trim()) return
    setQueryLoading(true)
    try {
      const res = await fetch("/api/db-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ sql: sql.trim() }),
      })
      const data = await res.json()
      setQueryResult(data)
      // refresh tables list (row counts may change after writes)
      loadTables()
    } finally {
      setQueryLoading(false)
    }
  }

  // ── Keyboard shortcut ────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault()
      runQuery()
    }
  }

  // ── Guard ────────────────────────────────────────────────────────────────

  if (authorized === null) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        验证身份中…
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-80 text-center p-8">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
          <p className="font-semibold text-lg mb-2">无权限</p>
          <p className="text-sm text-muted-foreground mb-4">此页面仅限 cshen 访问。</p>
          <Button variant="outline" onClick={() => router.replace("/dashboard")}>返回首页</Button>
        </Card>
      </div>
    )
  }

  const filteredTables = tables.filter(t =>
    t.table_name.toLowerCase().includes(tableFilter.toLowerCase()),
  )
  const totalPages = Math.ceil(previewTotal / PAGE_SIZE)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Left panel: table list ───────────────────────────────────── */}
      <aside className="w-64 border-r flex flex-col bg-card shrink-0">
        <div className="p-4 border-b flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">DB Explorer</p>
            <p className="text-xs text-muted-foreground">PostgreSQL</p>
          </div>
        </div>
        <div className="p-3 border-b">
          <Input
            placeholder="过滤表名…"
            value={tableFilter}
            onChange={e => setTableFilter(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {tablesLoading ? (
            <p className="p-4 text-xs text-muted-foreground text-center">加载中…</p>
          ) : filteredTables.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">无结果</p>
          ) : (
            filteredTables.map(t => (
              <button
                key={t.table_name}
                onClick={() => selectTable(t.table_name)}
                className={[
                  "w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted transition-colors",
                  selectedTable === t.table_name ? "bg-muted font-medium" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <TableIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.table_name}</span>
                </span>
                <span className="text-muted-foreground ml-1 shrink-0">
                  {parseInt(t.row_estimate) > 0
                    ? parseInt(t.row_estimate).toLocaleString()
                    : ""}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="p-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={loadTables}
            disabled={tablesLoading}
          >
            <RefreshCw className={["h-3.5 w-3.5", tablesLoading ? "animate-spin" : ""].join(" ")} />
            刷新表列表
          </Button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b px-6 py-3 flex items-center gap-3 bg-card">
          <Database className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">数据库浏览器</h1>
          {selectedTable && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <Badge variant="secondary" className="font-mono text-xs">{selectedTable}</Badge>
            </>
          )}
        </header>

        {/* Body */}
        {!selectedTable ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Database className="h-12 w-12 opacity-20" />
            <p className="text-sm">从左侧选择一张表开始浏览</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <Tabs defaultValue="data" className="flex-1 flex flex-col overflow-hidden">
              <div className="border-b px-4">
                <TabsList className="h-10 rounded-none bg-transparent border-none p-0 gap-1">
                  <TabsTrigger value="data" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-3 py-2">
                    数据预览
                  </TabsTrigger>
                  <TabsTrigger value="schema" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-3 py-2">
                    表结构
                  </TabsTrigger>
                  <TabsTrigger value="query" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-3 py-2">
                    SQL 查询
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* ── Data preview tab ─── */}
              <TabsContent value="data" className="flex-1 flex flex-col overflow-hidden m-0 p-0">
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Rows3 className="h-3.5 w-3.5" />
                    <span>共 <strong>{previewTotal.toLocaleString()}</strong> 行</span>
                    <Separator orientation="vertical" className="h-3.5" />
                    <span>第 {previewPage + 1} / {Math.max(totalPages, 1)} 页</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs gap-1"
                      onClick={exportTable}
                      disabled={exportLoading || !selectedTable}
                    >
                      {exportLoading
                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                        : <Download className="h-3 w-3" />}
                      导出该表
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => downloadCsv(previewCols, previewRows, `${selectedTable}_p${previewPage + 1}.csv`)}
                      disabled={previewRows.length === 0}
                    >
                      <Download className="h-3 w-3" />
                      导出本页 CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => downloadJson(previewRows, `${selectedTable}_p${previewPage + 1}.json`)}
                      disabled={previewRows.length === 0}
                    >
                      <Download className="h-3 w-3" />
                      JSON
                    </Button>
                  </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                  {previewLoading ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" /> 加载中…
                    </div>
                  ) : (
                    <Table className="text-xs whitespace-nowrap">
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          {previewCols.map(c => (
                            <TableHead key={c} className="font-semibold px-3 py-2">{c}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, i) => (
                          <TableRow key={i}>
                            {previewCols.map(c => (
                              <TableCell key={c} className="px-3 py-1.5 max-w-xs truncate">
                                {row[c] == null
                                  ? <span className="text-muted-foreground italic">NULL</span>
                                  : String(row[c])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t bg-card text-xs">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={previewPage === 0 || previewLoading}
                        onClick={() => handlePreviewPage(0)}
                      >
                        <ChevronsLeft className="h-3 w-3" /> 首页
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={previewPage === 0 || previewLoading}
                        onClick={() => handlePreviewPage(previewPage - 1)}
                      >
                        <ArrowLeft className="h-3 w-3" /> 上一页
                      </Button>
                    </div>
                    <span className="text-muted-foreground">
                      {previewPage * PAGE_SIZE + 1}–{Math.min((previewPage + 1) * PAGE_SIZE, previewTotal)} / {previewTotal.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={previewPage >= totalPages - 1 || previewLoading}
                        onClick={() => handlePreviewPage(previewPage + 1)}
                      >
                        下一页 <ArrowRight className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={previewPage >= totalPages - 1 || previewLoading}
                        onClick={() => handlePreviewPage(totalPages - 1)}
                      >
                        尾页 <ChevronsRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Schema tab ────── */}
              <TabsContent value="schema" className="flex-1 overflow-auto m-0 p-4 space-y-4">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">列定义</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {schemaLoading ? (
                      <p className="p-4 text-xs text-muted-foreground">加载中…</p>
                    ) : (
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-4">列名</TableHead>
                            <TableHead className="px-4">类型</TableHead>
                            <TableHead className="px-4">可空</TableHead>
                            <TableHead className="px-4">默认值</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columns.map(c => (
                            <TableRow key={c.column_name}>
                              <TableCell className="px-4 font-mono font-medium">{c.column_name}</TableCell>
                              <TableCell className="px-4 text-blue-600 dark:text-blue-400">{c.data_type}</TableCell>
                              <TableCell className="px-4">
                                {c.is_nullable === "YES"
                                  ? <span className="text-muted-foreground">YES</span>
                                  : <span className="font-medium">NO</span>}
                              </TableCell>
                              <TableCell className="px-4 font-mono text-muted-foreground">
                                {c.column_default ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                {indexes.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm">索引</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-4">索引名</TableHead>
                            <TableHead className="px-4">定义</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {indexes.map(idx => (
                            <TableRow key={idx.indexname}>
                              <TableCell className="px-4 font-mono font-medium">{idx.indexname}</TableCell>
                              <TableCell className="px-4 font-mono text-muted-foreground text-[11px] break-all">{idx.indexdef}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── SQL query tab ─── */}
              <TabsContent value="query" className="flex-1 flex flex-col overflow-hidden m-0 p-0">
                {/* Editor */}
                <div className="border-b p-4 space-y-2 bg-muted/20">
                  <textarea
                    ref={sqlRef}
                    value={sql}
                    onChange={e => setSql(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="在此输入 SQL，Ctrl+Enter 执行…"
                    className="w-full h-32 resize-y rounded-md border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    spellCheck={false}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={runQuery}
                      disabled={queryLoading || !sql.trim()}
                    >
                      {queryLoading
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Play className="h-3.5 w-3.5" />}
                      执行
                    </Button>
                    <span className="text-xs text-muted-foreground">Ctrl + Enter</span>
                    {queryResult && !queryResult.error && (
                      <>
                        <Separator orientation="vertical" className="h-4" />
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs"
                          onClick={() => downloadCsv(queryResult.columns, queryResult.rows, "query_result.csv")}
                          disabled={queryResult.rows.length === 0}
                        >
                          <Download className="h-3 w-3" />
                          导出 CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs"
                          onClick={() => downloadJson(queryResult.rows, "query_result.json")}
                          disabled={queryResult.rows.length === 0}
                        >
                          <Download className="h-3 w-3" />
                          JSON
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Result status bar */}
                {queryResult && (
                  <div className={[
                    "flex items-center gap-2 px-4 py-2 text-xs border-b",
                    queryResult.error
                      ? "bg-destructive/10 text-destructive"
                      : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
                  ].join(" ")}>
                    {queryResult.error
                      ? <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                    {queryResult.error ? (
                      <span>{queryResult.error}</span>
                    ) : (
                      <span>
                        {queryResult.command} — {queryResult.rowCount.toLocaleString()} 行受影响
                        <Clock className="inline h-3 w-3 mx-1.5 opacity-60" />
                        {queryResult.elapsed} ms
                      </span>
                    )}
                  </div>
                )}

                {/* Result table */}
                {queryResult && !queryResult.error && queryResult.rows.length > 0 && (
                  <div className="flex-1 overflow-auto">
                    <Table className="text-xs whitespace-nowrap">
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          {queryResult.columns.map(c => (
                            <TableHead key={c} className="px-3 py-2 font-semibold">{c}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryResult.rows.map((row, i) => (
                          <TableRow key={i}>
                            {queryResult.columns.map(c => (
                              <TableCell key={c} className="px-3 py-1.5 max-w-xs truncate">
                                {row[c] == null
                                  ? <span className="text-muted-foreground italic">NULL</span>
                                  : String(row[c])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {queryResult && !queryResult.error && queryResult.rows.length === 0 && (
                  <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    查询执行成功，无返回行。
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  )
}
