"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
import { ArrowLeft, FileSpreadsheet, Trash2, UploadCloud } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type ParsedRow = Record<string, string | number>

type ImportResult = {
  fileName: string
  sheetName?: string
  columns: string[]
  rowCount: number
  rows: ParsedRow[]
  warnings: string[]
}

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".tsv"]

function isAcceptedFile(file: File) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  return ACCEPTED_EXTENSIONS.includes(ext)
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as Record<string, unknown>).error === "string") {
    return (payload as Record<string, string>).error
  }
  return fallback
}

export default function DataImportPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const parseFile = useCallback(
    async (file: File) => {
      if (!isAcceptedFile(file)) {
        toast({
          title: "文件格式不支持",
          description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 格式。`,
          variant: "destructive",
        })
        return
      }

      setIsParsing(true)
      try {
        const formData = new FormData()
        formData.append("file", file)

        const response = await fetch("/ma/api/mom-analysis/data-import/parse", {
          method: "POST",
          body: formData,
        })

        const payload = (await response.json()) as ImportResult | { error: string }
        if (!response.ok) {
          throw new Error(readErrorMessage(payload, "文件解析失败。"))
        }

        setResult(payload as ImportResult)
        if (fileInputRef.current) fileInputRef.current.value = ""
        toast({ title: "解析完成", description: `共识别 ${(payload as ImportResult).rowCount} 行数据。` })
      } catch (error) {
        toast({
          title: "解析失败",
          description: error instanceof Error ? error.message : "文件解析失败。",
          variant: "destructive",
        })
      } finally {
        setIsParsing(false)
        setPendingFile(null)
      }
    },
    [toast],
  )

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

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setPendingFile(file)
  }

  function handleClear() {
    setResult(null)
    setPendingFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const previewRows = result?.rows.slice(0, 20) ?? []

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/ma/dashboard/mom-analysis">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回 MOM分析
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">数据导入</h1>
        <p className="mt-2 text-muted-foreground">上传基金净值或收益率文件，自动解析并预览数据。</p>
      </div>

      {/* Upload area */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">选择文件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors cursor-pointer
              ${isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50 hover:bg-muted/30"}`}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground/50" />
            {pendingFile ? (
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">{pendingFile.name}</span>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">拖拽文件至此，或点击选择</p>
                <p className="mt-1 text-xs text-muted-foreground">{ACCEPTED_EXTENSIONS.join(" / ")}</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              className="hidden"
              onChange={handleFileInputChange}
            />
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!pendingFile || isParsing}
              onClick={() => pendingFile && parseFile(pendingFile)}
            >
              {isParsing ? "解析中…" : "开始解析"}
            </Button>
            {result && (
              <Button variant="outline" size="icon" onClick={handleClear} title="清除结果">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{result.fileName}</Badge>
            {result.sheetName && <Badge variant="outline">工作表：{result.sheetName}</Badge>}
            <Badge variant="outline">{result.rowCount} 行</Badge>
            <Badge variant="outline">{result.columns.length} 列</Badge>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <Alert>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Preview table */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">
                数据预览
                {result.rowCount > 20 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">（仅显示前 20 行，共 {result.rowCount} 行）</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead key={col} className="whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((col) => (
                        <TableCell key={col} className="whitespace-nowrap text-xs">
                          {row[col] !== undefined && row[col] !== null ? String(row[col]) : "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
