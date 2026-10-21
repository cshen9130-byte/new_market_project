"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Download, FileScan, UploadCloud } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type PdfExcelMode = "auto" | "valuation" | "performance"

type PdfExcelSheet = {
  name: string
  columns: string[]
  rowCount: number
  preview: string[][]
}

type PdfExcelSummary = {
  sourceFileName: string
  downloadId: string
  detectedMode: "valuation" | "performance" | "tables"
  method: "text" | "ocr"
  pageCount: number
  meta: { field: string; value: string }[]
  sheets: PdfExcelSheet[]
  warnings: string[]
}

const MODE_LABEL: Record<PdfExcelSummary["detectedMode"], string> = {
  valuation: "估值表",
  performance: "业绩表",
  tables: "通用表格",
}

const METHOD_LABEL: Record<PdfExcelSummary["method"], string> = {
  text: "文字表格",
  ocr: "截图 OCR",
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

async function readConvertStream(
  response: Response,
  onProgress: (percent: number, message: string) => void,
): Promise<PdfExcelSummary> {
  if (response.status === 413) {
    throw new Error("文件超过服务器上传限制。请把 PDF 压到 40MB 以内后重试。")
  }
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as PdfExcelSummary | { error?: string }
    if (!response.ok) throw new Error(readErrorMessage(payload, "PDF 提取失败。"))
    return payload as PdfExcelSummary
  }
  if (!response.ok || !response.body) {
    throw new Error(response.status ? `PDF 提取失败（HTTP ${response.status}）。` : "PDF 提取失败。")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let summary: PdfExcelSummary | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as {
        type?: string
        percent?: number
        message?: string
        summary?: PdfExcelSummary
        error?: string
      }
      if (event.type === "progress") {
        if (typeof event.percent === "number") onProgress(Math.max(4, Math.min(99, event.percent)), event.message || "")
      } else if (event.type === "result" && event.summary) {
        summary = event.summary
      } else if (event.type === "error") {
        throw new Error(event.error || "PDF 提取失败。")
      }
    }
  }
  if (!summary) throw new Error("提取结果无法读取。")
  return summary
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

export default function PdfToExcelToolPage() {
  const { toast } = useToast()
  const [mode, setMode] = useState<PdfExcelMode>("auto")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [result, setResult] = useState<PdfExcelSummary | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [progressValue, setProgressValue] = useState(0)
  const [progressMessage, setProgressMessage] = useState("")
  const [elapsedSec, setElapsedSec] = useState(0)

  const activeSheet = result?.sheets[sheetIndex] ?? result?.sheets[0]
  const shownProgress = result ? 100 : progressValue

  useEffect(() => {
    if (!isConverting) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isConverting])

  function takeFile(file: File | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "文件格式不支持", description: "请上传 PDF 文件。", variant: "destructive" })
      return
    }
    setPendingFile(file)
    setResult(null)
    setSheetIndex(0)
  }

  async function handleConvert() {
    if (!pendingFile) {
      toast({ title: "未选择文件", description: "请先拖入或点击区域选择一个 PDF。", variant: "destructive" })
      return
    }
    setIsConverting(true)
    setProgressValue(4)
    setProgressMessage("正在上传")
    setElapsedSec(0)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append("file", pendingFile)
      formData.append("mode", mode)
      const response = await fetch("/ma/api/tools/pdf-to-excel/convert", {
        method: "POST",
        body: formData,
      })
      const summary = await readConvertStream(response, (percent, message) => {
        setProgressValue((current) => Math.max(current, percent))
        if (message) setProgressMessage(message)
      })
      setProgressValue(100)
      setProgressMessage("提取完成")
      setResult(summary)
      setSheetIndex(0)
      toast({
        title: "提取完成",
        description: summary.method === "ocr" ? "业绩截图已识别，下载前请核对百分比。" : "表格已提取，可以下载 Excel。",
      })
    } catch (error) {
      setProgressValue(0)
      setProgressMessage("")
      toast({
        title: "提取失败",
        description: error instanceof Error ? error.message : "PDF 提取失败。",
        variant: "destructive",
      })
    } finally {
      setIsConverting(false)
    }
  }

  async function handleDownload() {
    if (!result) return
    setIsDownloading(true)
    try {
      const response = await fetch(`/ma/api/tools/pdf-to-excel/download?id=${encodeURIComponent(result.downloadId)}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(readErrorMessage(payload, "下载失败。"))
      }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get("content-disposition") || ""
      const matchedFileName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const fileName = matchedFileName ? decodeURIComponent(matchedFileName) : "pdf_extract.xlsx"
      const anchor = document.createElement("a")
      anchor.href = downloadUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)
      toast({ title: "下载完成", description: "Excel 已生成。原始 PDF 不会保存在服务器上。" })
    } catch (error) {
      toast({
        title: "下载失败",
        description: error instanceof Error ? error.message : "Excel 下载失败。",
        variant: "destructive",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  function clearAll() {
    setPendingFile(null)
    setResult(null)
    setSheetIndex(0)
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
            <h1 className="text-3xl font-semibold tracking-tight">PDF 转 Excel</h1>
            <p className="mt-2 text-muted-foreground">上传基金估值表或业绩 PDF，提取表格并导出 Excel。</p>
          </div>
        </div>
        <div className="w-full max-w-sm space-y-2 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">处理进度</span>
            <span>{isConverting ? `${shownProgress}% · ${formatElapsed(elapsedSec)}` : `${shownProgress}%`}</span>
          </div>
          <Progress value={shownProgress} />
          <p className="text-xs text-muted-foreground">
            {isConverting ? progressMessage || "正在识别" : result ? "提取完成" : "等待上传"}
          </p>
        </div>
      </div>

      <Alert>
        <FileScan className="h-4 w-4" />
        <AlertTitle>支持两类 PDF</AlertTitle>
        <AlertDescription>
          估值表识别科目代码、科目名称等文字表格。业绩表识别基金简称、管理人、策略和收益列；没有文字层的长图截图会走 OCR，耗时更长，百分比正负号需要核对。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. 选择类型并上传</CardTitle>
          <CardDescription>自动识别会优先读文字表格，读不到时再按业绩截图做 OCR。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <div className="text-sm text-muted-foreground">提取类型</div>
            <Select value={mode} onValueChange={(value) => setMode(value as PdfExcelMode)} disabled={isConverting}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动识别</SelectItem>
                <SelectItem value="valuation">估值表</SelectItem>
                <SelectItem value="performance">业绩表</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
              isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isConverting ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setIsDragOver(true)
            }}
            onDragEnter={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setIsDragOver(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setIsDragOver(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setIsDragOver(false)
              takeFile(event.dataTransfer.files?.[0])
            }}
            onClick={() => {
              if (isConverting) return
              const input = document.getElementById("pdf-to-excel-file") as HTMLInputElement | null
              input?.click()
            }}
          >
            <input
              id="pdf-to-excel-file"
              type="file"
              accept="application/pdf,.pdf"
              disabled={isConverting}
              className="sr-only"
              onChange={(event) => takeFile(event.target.files?.[0])}
            />
            <UploadCloud className={`h-10 w-10 transition-colors ${isDragOver ? "text-primary" : pendingFile ? "text-green-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {isDragOver ? "松开鼠标以上传" : pendingFile ? pendingFile.name : "拖拽 PDF 到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingFile ? "文件已就绪，点击下方按钮开始提取" : "支持估值表 PDF 与业绩 PDF，最大 40MB"}
              </p>
            </div>
            <Button
              type="button"
              variant={pendingFile ? "default" : "outline"}
              size="sm"
              disabled={isConverting}
              onClick={(event) => {
                event.stopPropagation()
                if (!pendingFile) {
                  const input = document.getElementById("pdf-to-excel-file") as HTMLInputElement | null
                  input?.click()
                  return
                }
                void handleConvert()
              }}
            >
              <FileScan className="h-4 w-4" />
              {isConverting ? "提取中..." : pendingFile ? "开始提取" : "选择文件"}
            </Button>
          </div>
          {isConverting && mode !== "valuation" ? (
            <p className="text-sm text-muted-foreground">业绩长图会按段识别，进度会跟着往前走。页数多时可能要几分钟，请保持页面打开。</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>2. 预览并下载</CardTitle>
              <CardDescription>工作簿包含「概要」和提取出的表格。这里展示前若干行。</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={clearAll} disabled={!pendingFile && !result}>
                清空
              </Button>
              <Button onClick={() => void handleDownload()} disabled={!result || isDownloading}>
                <Download className="h-4 w-4" />
                {isDownloading ? "下载中..." : "下载 Excel"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">文件：{result.sourceFileName}</Badge>
              <Badge variant="outline">识别为：{MODE_LABEL[result.detectedMode]}</Badge>
              <Badge variant="outline">方式：{METHOD_LABEL[result.method]}</Badge>
              <Badge variant="outline">页数：{result.pageCount}</Badge>
              {result.meta
                .filter((item) => item.field !== "类型" && item.field !== "识别方式" && item.field !== "页数")
                .slice(0, 6)
                .map((item) => (
                  <Badge key={`${item.field}-${item.value}`} variant="outline">
                    {item.field}：{item.value}
                  </Badge>
                ))}
            </div>
          ) : null}

          {result?.warnings.length ? (
            <Alert>
              <AlertTitle>提取说明</AlertTitle>
              <AlertDescription>
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}

          {result && result.sheets.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {result.sheets.map((sheet, index) => (
                <Button
                  key={sheet.name}
                  type="button"
                  size="sm"
                  variant={index === sheetIndex ? "default" : "outline"}
                  onClick={() => setSheetIndex(index)}
                >
                  {sheet.name}（{sheet.rowCount}）
                </Button>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {(activeSheet?.columns ?? ["列"]).map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSheet && activeSheet.preview.length > 0 ? (
                  activeSheet.preview.map((row, rowIndex) => (
                    <TableRow key={`${activeSheet.name}-${rowIndex}`}>
                      {activeSheet.columns.map((column, columnIndex) => (
                        <TableCell key={`${column}-${columnIndex}`}>{row[columnIndex] ?? ""}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={Math.max(activeSheet?.columns.length ?? 1, 1)} className="py-8 text-center text-muted-foreground">
                      上传 PDF 并提取后，这里会展示表格预览。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {activeSheet ? (
            <p className="text-sm text-muted-foreground">
              {activeSheet.name} 共 {activeSheet.rowCount} 行，预览 {activeSheet.preview.length} 行。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
