"use client"

import Link from "next/link"
import { useCallback, useMemo, useRef, useState } from "react"
import { ArrowLeft, Download, FileSpreadsheet, ScanSearch, Trash2, UploadCloud, WandSparkles } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type NavCleanerRow = {
  date: string
  unitNav: number
  cumulativeNav: number
  sourceDate: string
  sourceUnitNav: string
  sourceCumulativeNav: string
  isChinaTradingDay: boolean
}

type NavCleanerAnalysis = {
  sourceFileName: string
  sheetName: string
  headerRowNumber: number
  detectedColumns: {
    date: string | null
    unitNav: string | null
    cumulativeNav: string | null
  }
  inferredDateFormat: string
  totalSourceRows: number
  validRowCount: number
  duplicateDateCount: number
  nonTradingDayCount: number
  warnings: string[]
  rows: NavCleanerRow[]
}

function formatNav(value: number) {
  return value.toFixed(4)
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

export default function NavCleanerToolPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const [selectedFileName, setSelectedFileName] = useState("")
  const [analysis, setAnalysis] = useState<NavCleanerAnalysis | null>(null)
  const [workingRows, setWorkingRows] = useState<NavCleanerRow[]>([])
  const [hasConverted, setHasConverted] = useState(false)
  const [nonTradingDaysRemoved, setNonTradingDaysRemoved] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const currentRows = hasConverted ? workingRows : analysis?.rows ?? []
  const progressValue = useMemo(() => {
    if (!analysis) return 0
    if (!hasConverted) return 45
    if (!nonTradingDaysRemoved) return 75
    return 100
  }, [analysis, hasConverted, nonTradingDaysRemoved])

  const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".tsv"]

  function isAcceptedFile(file: File) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
    return ACCEPTED_EXTENSIONS.includes(ext)
  }

  const analyzeFile = useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 格式。`,
        variant: "destructive",
      })
      return
    }

    setIsAnalyzing(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/ma/api/tools/nav-cleaner/analyze", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as NavCleanerAnalysis | { error: string }
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "净值文件识别失败。"))
      }

      const result = payload as NavCleanerAnalysis
      setAnalysis(result)
      setWorkingRows([])
      setHasConverted(false)
      setNonTradingDaysRemoved(false)
      setSelectedFileName(file.name)

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }

      toast({
        title: "识别完成",
        description: "原始上传文件仅在处理时进入内存，当前未保存在服务器磁盘。",
      })
    } catch (error) {
      toast({
        title: "识别失败",
        description: error instanceof Error ? error.message : "净值文件识别失败。",
        variant: "destructive",
      })
    } finally {
      setIsAnalyzing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleAnalyze() {
    if (!pendingFile) {
      toast({
        title: "未选择文件",
        description: "请先拖入或点击区域选择一个 xlsx / xls / csv / tsv 文件。",
        variant: "destructive",
      })
      return
    }
    await analyzeFile(pendingFile)
    setPendingFile(null)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!isAcceptedFile(file)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 格式。`,
        variant: "destructive",
      })
      return
    }
    setPendingFile(file)
  }

  function handleConvert() {
    if (!analysis) return
    setWorkingRows(analysis.rows)
    setHasConverted(true)
    setNonTradingDaysRemoved(false)
    toast({
      title: "已转换为模板结构",
      description: "当前结果已经整理成“日期 / 单位净值 / 累计净值”结构。",
    })
  }

  function handleRemoveNonTradingDays() {
    if (!analysis || !hasConverted) return
    const filteredRows = analysis.rows.filter((row) => row.isChinaTradingDay)
    setWorkingRows(filteredRows)
    setNonTradingDaysRemoved(true)
    toast({
      title: "已删除非交易日",
      description: `共移除 ${analysis.rows.length - filteredRows.length} 行中国市场非交易日数据。`,
    })
  }

  function handleRestoreConvertedRows() {
    if (!analysis) return
    setWorkingRows(analysis.rows)
    setHasConverted(true)
    setNonTradingDaysRemoved(false)
  }

  function clearAll() {
    setAnalysis(null)
    setWorkingRows([])
    setHasConverted(false)
    setNonTradingDaysRemoved(false)
    setSelectedFileName("")
    setPendingFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  async function handleDownload() {
    if (!hasConverted || currentRows.length === 0) return

    setIsDownloading(true)
    try {
      const response = await fetch("/ma/api/tools/nav-cleaner/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rows: currentRows,
          sourceFileName: selectedFileName,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(readErrorMessage(payload, "下载失败。"))
      }

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get("content-disposition") || ""
      const matchedFileName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const fileName = matchedFileName ? decodeURIComponent(matchedFileName) : "nav_template.xlsx"
      const anchor = document.createElement("a")
      anchor.href = downloadUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)

      toast({
        title: "下载完成",
        description: "模板文件已生成。原始上传文件没有保存在服务器磁盘。",
      })
    } catch (error) {
      toast({
        title: "下载失败",
        description: error instanceof Error ? error.message : "模板文件下载失败。",
        variant: "destructive",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Link href="/ma/dashboard/tools" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回小工具
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">净值表识别及清洗</h1>
            <p className="mt-2 text-muted-foreground">上传净值文件后自动识别日期列和净值列，并导出为上传净值模版格式。</p>
          </div>
        </div>
        <div className="w-full max-w-sm space-y-2 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">处理进度</span>
            <span>{progressValue}%</span>
          </div>
          <Progress value={progressValue} />
        </div>
      </div>

      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>支持格式</AlertTitle>
        <AlertDescription>
          支持 xlsx、xls、xlsm、xlsb、csv、tsv。上传文件只在识别请求中进入内存，不会落盘保存；清空或离开页面后不会留下原始上传文件。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. 上传并识别</CardTitle>
          <CardDescription>自动识别日期、单位净值、累计净值列，并预估当前日期格式。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isAnalyzing ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              id="nav-cleaner-file"
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.tsv"
              disabled={isAnalyzing}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setPendingFile(file)
              }}
            />
            <UploadCloud className={`h-10 w-10 transition-colors ${isDragOver ? "text-primary" : pendingFile ? "text-green-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {isDragOver ? "松开鼠标以上传" : pendingFile ? pendingFile.name : "拖拽文件到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingFile ? "文件已就绪，点击下方按钮开始识别" : "支持 xlsx · xls · xlsm · xlsb · csv · tsv"}
              </p>
            </div>
            <Button
              type="button"
              variant={pendingFile ? "default" : "outline"}
              size="sm"
              disabled={isAnalyzing}
              onClick={(e) => { e.stopPropagation(); void handleAnalyze() }}
            >
              <ScanSearch className="h-4 w-4" />
              {isAnalyzing ? "识别中..." : pendingFile ? "开始识别" : "选择文件"}
            </Button>
          </div>

          {analysis ? (
            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">文件：{analysis.sourceFileName}</Badge>
                  <Badge variant="outline">工作表：{analysis.sheetName}</Badge>
                  <Badge variant="outline">表头行：第 {analysis.headerRowNumber} 行</Badge>
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground">日期列</div>
                    <div className="font-medium">{analysis.detectedColumns.date || "未识别"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">单位净值列</div>
                    <div className="font-medium">{analysis.detectedColumns.unitNav || "未识别"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">累计净值列</div>
                    <div className="font-medium">{analysis.detectedColumns.cumulativeNav || "未识别"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">识别到的日期格式</div>
                    <div className="font-medium">{analysis.inferredDateFormat}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground">原始数据行</div>
                    <div className="text-2xl font-semibold">{analysis.totalSourceRows}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">有效净值行</div>
                    <div className="text-2xl font-semibold">{analysis.validRowCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">重复日期</div>
                    <div className="text-2xl font-semibold">{analysis.duplicateDateCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">非交易日</div>
                    <div className="text-2xl font-semibold">{analysis.nonTradingDayCount}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {analysis?.warnings.length ? (
            <Alert>
              <WandSparkles className="h-4 w-4" />
              <AlertTitle>自动清洗说明</AlertTitle>
              <AlertDescription>
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. 转换与清洗</CardTitle>
          <CardDescription>先整理成上传净值模版结构，再按需删除中国市场非交易日。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleConvert} disabled={!analysis}>
              <WandSparkles className="h-4 w-4" />
              转换为模版格式
            </Button>
            <Button variant="outline" onClick={handleRemoveNonTradingDays} disabled={!hasConverted || analysis?.nonTradingDayCount === 0 || nonTradingDaysRemoved}>
              <Trash2 className="h-4 w-4" />
              删除中国市场非交易日
            </Button>
            <Button variant="outline" onClick={handleRestoreConvertedRows} disabled={!hasConverted || !nonTradingDaysRemoved}>
              恢复转换结果
            </Button>
            <Button variant="outline" onClick={clearAll} disabled={!analysis && !selectedFileName}>
              清空当前结果
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">目标列：日期</Badge>
            <Badge variant="outline">目标列：单位净值</Badge>
            <Badge variant="outline">目标列：累计净值</Badge>
            {hasConverted ? <Badge>已完成结构转换</Badge> : null}
            {nonTradingDaysRemoved ? <Badge>已移除非交易日</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>3. 下载结果</CardTitle>
              <CardDescription>导出为与上传净值模版一致的 xlsx 文件。</CardDescription>
            </div>
            <Button onClick={handleDownload} disabled={!hasConverted || currentRows.length === 0 || isDownloading}>
              <Download className="h-4 w-4" />
              {isDownloading ? "生成中..." : "下载调整后文件"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">当前可下载行数</div>
              <div className="text-2xl font-semibold">{currentRows.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">已删除非交易日行数</div>
              <div className="text-2xl font-semibold">{hasConverted ? analysis ? analysis.validRowCount - currentRows.length : 0 : 0}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">下载格式</div>
              <div className="text-2xl font-semibold">XLSX</div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">单位净值</TableHead>
                <TableHead className="text-right">累计净值</TableHead>
                <TableHead>交易日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentRows.slice(0, 12).map((row) => (
                <TableRow key={`${row.date}-${row.unitNav}-${row.cumulativeNav}`}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="text-right">{formatNav(row.unitNav)}</TableCell>
                  <TableCell className="text-right">{formatNav(row.cumulativeNav)}</TableCell>
                  <TableCell>{row.isChinaTradingDay ? "是" : "否"}</TableCell>
                </TableRow>
              ))}
              {currentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    先上传文件并执行转换，随后这里会展示模版格式预览。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}