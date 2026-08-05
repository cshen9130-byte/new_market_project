"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { Activity, ArrowLeft, ScanSearch, Trash2, UploadCloud } from "lucide-react"

import {
  NavAttributionPanel,
  guessAttributionFactorModel,
  type AttributionFactorModel,
} from "@/app/ma/dashboard/private-funds/[beian_hao]/components/NavAttributionPanel"
import type { NavRow } from "@/app/ma/dashboard/private-funds/[beian_hao]/components/shared"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type NavTypeOption = "单位净值" | "累计净值" | "复权净值"

type UploadedNavRow = {
  date: string
  unitNav: number
  cumulativeNav: number
  adjustedNav?: number | null
  productCode?: string | null
  fundName?: string | null
}

type NavUploadAnalysis = {
  sourceFileName: string
  sheetName: string
  detectedColumns: {
    date: string | null
    unitNav: string | null
    cumulativeNav: string | null
    adjustedNav?: string | null
  }
  validRowCount: number
  warnings: string[]
  rows: UploadedNavRow[]
}

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".tsv"]

function isAcceptedFile(file: File) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  return ACCEPTED_EXTENSIONS.includes(ext)
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

function toNavRows(rows: UploadedNavRow[]): NavRow[] {
  return rows
    .filter((row) => row.date && Number.isFinite(row.unitNav) && row.unitNav > 0)
    .map((row) => {
      const cumulative = Number.isFinite(row.cumulativeNav) && row.cumulativeNav > 0
        ? row.cumulativeNav
        : row.unitNav
      const adjusted = row.adjustedNav != null && Number.isFinite(row.adjustedNav) && row.adjustedNav > 0
        ? row.adjustedNav
        : cumulative
      return {
        price_date: row.date.slice(0, 10),
        nav: String(row.unitNav),
        cumulative_nav: String(adjusted),
        cum_nav_withdrawal: String(cumulative),
        price_change: "0",
      }
    })
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
}

function pickProductName(analysis: NavUploadAnalysis): string {
  const named = analysis.rows.find((row) => row.fundName?.trim())?.fundName?.trim()
  if (named) return named
  const base = analysis.sourceFileName.replace(/\.[^.]+$/, "")
  return base || "上传产品"
}

export default function NavAttributionToolPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<NavUploadAnalysis | null>(null)
  const [navType, setNavType] = useState<NavTypeOption>("复权净值")
  const [productName, setProductName] = useState("")
  const [factorModel, setFactorModel] = useState<AttributionFactorModel>("multi-asset")

  const navRows = useMemo(
    () => (analysis ? toNavRows(analysis.rows) : []),
    [analysis],
  )

  const dateFrom = navRows[0]?.price_date ?? ""
  const dateTo = navRows[navRows.length - 1]?.price_date ?? ""
  const dateRangeLabel = dateFrom && dateTo ? `${dateFrom} ~ ${dateTo}` : "—"

  const availableNavTypes = useMemo(() => {
    if (!analysis) return [] as NavTypeOption[]
    const types: NavTypeOption[] = []
    if (analysis.detectedColumns.unitNav) types.push("单位净值")
    if (analysis.detectedColumns.cumulativeNav) types.push("累计净值")
    if (analysis.detectedColumns.adjustedNav || analysis.rows.some((r) => r.adjustedNav != null)) {
      types.push("复权净值")
    }
    if (!types.length) types.push("单位净值")
    return types
  }, [analysis])

  async function analyzeFile(file: File) {
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
      const payload = (await response.json()) as NavUploadAnalysis | { error: string }
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "净值文件识别失败。"))
      }

      const result = payload as NavUploadAnalysis
      const rows = toNavRows(result.rows)
      if (rows.length < 30) {
        throw new Error(`有效净值点不足（当前 ${rows.length} 个），归因分析至少需要 30 个净值点。`)
      }

      setAnalysis(result)
      const name = pickProductName(result)
      setProductName(name)
      setFactorModel(guessAttributionFactorModel(`${name} ${result.sourceFileName}`))

      const types: NavTypeOption[] = []
      if (result.detectedColumns.unitNav) types.push("单位净值")
      if (result.detectedColumns.cumulativeNav) types.push("累计净值")
      if (result.detectedColumns.adjustedNav || result.rows.some((r) => r.adjustedNav != null)) {
        types.push("复权净值")
      }
      if (!types.length) types.push("单位净值")
      setNavType(types.includes("复权净值") ? "复权净值" : types[0])

      if (fileInputRef.current) fileInputRef.current.value = ""
      setPendingFile(null)

      const model = guessAttributionFactorModel(`${name} ${result.sourceFileName}`)
      toast({
        title: "识别完成",
        description:
          model === "multi-asset"
            ? `已识别 ${rows.length} 个有效净值点，将按多资产大类因子（权益/债/金/商品）做归因。`
            : `已识别 ${rows.length} 个有效净值点，将按商品CTA风格因子做归因。`,
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
  }

  async function handleAnalyze() {
    if (!pendingFile) {
      toast({
        title: "未选择文件",
        description: "请先拖入或点击区域选择一个净值文件。",
        variant: "destructive",
      })
      return
    }
    await analyzeFile(pendingFile)
  }

  function clearAll() {
    setPendingFile(null)
    setAnalysis(null)
    setProductName("")
    setNavType("复权净值")
    setFactorModel("multi-asset")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="space-y-6 pt-6">
      <div className="space-y-2">
        <Link
          href="/ma/dashboard/tools"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回小工具
        </Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">净值归因</h1>
          <p className="mt-2 text-muted-foreground">
            上传产品净值数据，按策略类型选择多资产大类或商品CTA风格因子，生成回归分析报告。
          </p>
        </div>
      </div>

      <Alert>
        <Activity className="h-4 w-4" />
        <AlertTitle>支持格式</AlertTitle>
        <AlertDescription>
          支持 xlsx、xls、xlsm、xlsb、csv、tsv。自动识别日期与净值列；上传文件仅在内存中处理，不会落盘保存。
          报告包含区间因子回归、风格因子解释、因子收益/风险贡献，以及年度/季度敏感度趋势。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. 上传产品净值</CardTitle>
          <CardDescription>
            识别日期、单位净值、累计净值（及复权净值）列后，即可运行风格归因分析。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isAnalyzing ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(true)
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) setPendingFile(file)
            }}
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.tsv"
              disabled={isAnalyzing}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setPendingFile(file)
              }}
            />
            <UploadCloud
              className={`h-10 w-10 transition-colors ${
                isDragOver ? "text-primary" : pendingFile ? "text-green-500" : "text-muted-foreground"
              }`}
            />
            <div>
              <p className="text-sm font-medium">
                {isDragOver
                  ? "松开鼠标以上传"
                  : pendingFile
                    ? pendingFile.name
                    : "拖拽净值文件到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingFile
                  ? "文件已就绪，点击下方按钮开始识别并归因"
                  : "支持 xlsx · xls · xlsm · xlsb · csv · tsv · 建议不少于 30 个净值点"}
              </p>
            </div>
            <Button
              type="button"
              variant={pendingFile ? "default" : "outline"}
              size="sm"
              disabled={isAnalyzing}
              onClick={(e) => {
                e.stopPropagation()
                void handleAnalyze()
              }}
            >
              <ScanSearch className="h-4 w-4" />
              {isAnalyzing ? "识别中..." : pendingFile ? "开始归因分析" : "选择文件"}
            </Button>
          </div>

          {analysis && (
            <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
              <div className="space-y-1 min-w-[200px] flex-1">
                <label className="text-xs text-muted-foreground">产品名称</label>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="用于报告标题与导出文件名"
                />
              </div>
              <div className="space-y-1 w-[160px]">
                <label className="text-xs text-muted-foreground">净值类型</label>
                <Select value={navType} onValueChange={(v) => setNavType(v as NavTypeOption)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableNavTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearAll}>
                <Trash2 className="h-4 w-4" />
                清空
              </Button>
            </div>
          )}

          {analysis && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">文件：{analysis.sourceFileName}</Badge>
              <Badge variant="outline">工作表：{analysis.sheetName}</Badge>
              <Badge variant="outline">有效净值：{navRows.length}</Badge>
              <Badge variant="outline">区间：{dateRangeLabel}</Badge>
              {analysis.detectedColumns.date && (
                <Badge variant="outline">日期列：{analysis.detectedColumns.date}</Badge>
              )}
              {analysis.detectedColumns.unitNav && (
                <Badge variant="outline">单位净值：{analysis.detectedColumns.unitNav}</Badge>
              )}
              {analysis.detectedColumns.cumulativeNav && (
                <Badge variant="outline">累计净值：{analysis.detectedColumns.cumulativeNav}</Badge>
              )}
            </div>
          )}

          {analysis?.warnings?.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
              {analysis.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {analysis && navRows.length >= 30 && (
        <Card>
          <CardHeader>
            <CardTitle>2. 归因报告</CardTitle>
            <CardDescription>
              FOF/综合产品默认使用多资产大类因子（沪深300、中证500/1000、国债ETF、黄金ETF、南华商品等）；
              商品CTA策略可切换为南华风格因子模型。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NavAttributionPanel
              productName={productName || "上传产品"}
              dateRangeLabel={dateRangeLabel}
              dateFrom={dateFrom}
              dateTo={dateTo}
              rows={navRows}
              navType={navType}
              benchmarkSeries={[]}
              hasBenchmark={false}
              defaultFactorModel={factorModel}
              showFactorModelSelect
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
