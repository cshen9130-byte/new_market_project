"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, BarChart2, FileText, Search, Trash2 } from "lucide-react"

const TEAM_VALUATION_UPLOAD_MAX_FILES = 100

type FundSearchResult = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

function openValuationAnalysisPage(beian_hao: string) {
  window.open(
    `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}/valuation`,
    "_blank",
    "noopener,noreferrer",
  )
}

export default function ValuationTableAnalysisToolPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [fundQuery, setFundQuery] = useState("")
  const [fundOptions, setFundOptions] = useState<FundSearchResult[]>([])
  const [fundLoading, setFundLoading] = useState(false)
  const [fundShowDropdown, setFundShowDropdown] = useState(false)
  const [fundSearchError, setFundSearchError] = useState<string | null>(null)
  const [selectedFund, setSelectedFund] = useState<FundSearchResult | null>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = fundQuery.trim()
    if (!q || selectedFund?.product_name === fundQuery) {
      setFundOptions([])
      setFundSearchError(null)
      setFundLoading(false)
      return
    }

    setFundLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (!res.ok || json?.error) {
          setFundOptions([])
          setFundSearchError("基金搜索失败，请稍后重试")
          return
        }
        const rows = Array.isArray(json) ? (json as FundSearchResult[]) : []
        setFundOptions(rows)
        setFundSearchError(rows.length === 0 ? "未找到匹配基金，可尝试输入备案号或产品名" : null)
        setFundShowDropdown(true)
      } catch {
        setFundOptions([])
        setFundSearchError("基金搜索失败，请检查网络后重试")
      } finally {
        setFundLoading(false)
      }
    }, 250)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [fundQuery, selectedFund?.product_name])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setFundShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function selectFund(fund: FundSearchResult) {
    setSelectedFund(fund)
    setFundQuery(fund.product_name)
    setFundShowDropdown(false)
    setFundSearchError(null)
    setStagedFiles([])
    setMessage(null)
    setError(null)
  }

  function clearSelectedFund() {
    setSelectedFund(null)
    setFundQuery("")
    setFundOptions([])
    setStagedFiles([])
    setMessage(null)
    setError(null)
  }

  function stageFiles(rawFiles: FileList | File[]) {
    if (!selectedFund) {
      setError("请先搜索并选择产品")
      setMessage(null)
      return
    }

    const incoming = Array.from(rawFiles).filter((file) => /\.xlsx?$/i.test(file.name))
    if (incoming.length === 0) {
      setError("请选择 .xls 或 .xlsx 格式的估值表")
      setMessage(null)
      return
    }

    const byKey = new Map(stagedFiles.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]))
    for (const file of incoming) {
      byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file)
    }
    const next = [...byKey.values()]
    if (next.length > TEAM_VALUATION_UPLOAD_MAX_FILES) {
      setError(`每次最多导入 ${TEAM_VALUATION_UPLOAD_MAX_FILES} 份估值表`)
      setMessage(null)
      return
    }
    setStagedFiles(next)
    setError(null)
    setMessage(null)
  }

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
    setError(null)
  }

  async function importStagedFiles() {
    if (!selectedFund) {
      setError("请先搜索并选择产品")
      setMessage(null)
      return
    }
    if (stagedFiles.length === 0) {
      setError("请先拖入或选择估值表，再点击导入")
      setMessage(null)
      return
    }

    setImporting(true)
    setError(null)
    setMessage(null)
    try {
      const form = new FormData()
      form.append("beian_hao", selectedFund.beian_hao)
      form.append("product_name", selectedFund.product_name)
      for (const file of stagedFiles) form.append("files", file)

      const res = await fetch("/ma/api/ops/team-data/valuation/upload", {
        method: "POST",
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "导入失败")
      }

      const saved = typeof json.saved === "number" ? json.saved : stagedFiles.length
      const failed = Array.isArray(json.failed) ? (json.failed as string[]) : []
      if (failed.length > 0) {
        setMessage(`成功解析 ${saved} 份估值表，${failed.length} 份失败。可点击「打开估值表页」核对。`)
        setError(failed.slice(0, 3).join("；"))
      } else {
        setMessage(`成功解析 ${saved} 份估值表。可点击「打开估值表页」核对是否已展示。`)
      }
      setStagedFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败")
    } finally {
      setImporting(false)
    }
  }

  const productName = selectedFund?.product_name ?? ""

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-6 pt-6">
      <div className="space-y-2 flex-shrink-0">
        <Link
          href="/ma/dashboard/tools"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回小工具
        </Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">估值表分析</h1>
          <p className="mt-2 text-muted-foreground">
            搜索并选择产品后，上传估值表解析入库，功能与「私募基金 → 运维 → 估值表管理」一致。
          </p>
        </div>
      </div>

      <div ref={searchWrapRef} className="relative max-w-xl flex-shrink-0">
        <label className="text-xs text-muted-foreground">搜索产品</label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={fundQuery}
            onChange={(e) => {
              setFundQuery(e.target.value)
              setSelectedFund(null)
              setStagedFiles([])
              setMessage(null)
              setError(null)
              setFundShowDropdown(true)
            }}
            onFocus={() => {
              if (fundOptions.length > 0) setFundShowDropdown(true)
            }}
            placeholder="输入产品名称或备案号"
            className="w-full rounded border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {fundShowDropdown && fundOptions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded border bg-background shadow-lg">
            {fundOptions.map((opt) => (
              <button
                key={opt.beian_hao}
                type="button"
                onClick={() => selectFund(opt)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <div>{opt.product_name}</div>
                <div className="text-xs text-muted-foreground">{opt.beian_hao}</div>
              </button>
            ))}
          </div>
        )}
        {fundLoading && <p className="mt-1 text-xs text-muted-foreground">搜索中…</p>}
        {fundSearchError && !fundLoading && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{fundSearchError}</p>
        )}
        {selectedFund && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            已选择：{selectedFund.product_name}（{selectedFund.beian_hao}）
          </p>
        )}
      </div>

      {!selectedFund ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-16 text-center text-sm text-muted-foreground">
          请先搜索并选择产品，再上传估值表。
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 mb-4 flex-shrink-0 flex-wrap">
            <h2 className="text-xl font-semibold text-foreground">{productName}</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-50 text-red-500 border border-red-200 dark:bg-red-950/30 dark:border-red-800">
              估值表管理
            </span>
            <button
              type="button"
              onClick={() => openValuationAnalysisPage(selectedFund.beian_hao)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm text-foreground hover:bg-muted transition-colors"
            >
              <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />
              打开估值表页
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 text-sm text-zinc-800 px-4 py-3 mb-6 rounded flex-shrink-0 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-100">
            请确保该资产已上传4级估值表，否则可能无法解析。拖入文件后需点击「导入估值表」才会解析入库。
          </div>

          <div
            className={[
              "flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 min-h-[240px] px-6 py-10 transition-colors flex-shrink-0",
              isDragOver ? "border-red-400 bg-red-50/30 dark:bg-red-950/10" : "border-muted-foreground/20",
            ].join(" ")}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              if (e.dataTransfer.files.length > 0) stageFiles(e.dataTransfer.files)
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) stageFiles(e.target.files)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-2 rounded border bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50 mb-4"
            >
              选择估值表
            </button>
            <p className="text-sm text-muted-foreground text-center">
              请拖入或选择【{productName}】的估值表，格式限制为 .xls / .xlsx
            </p>
            <p className="text-sm text-muted-foreground text-center mt-1">
              每次最多 {TEAM_VALUATION_UPLOAD_MAX_FILES} 份；选好后点击下方「导入估值表」进行解析。
            </p>
          </div>

          {stagedFiles.length > 0 && (
            <div className="mt-4 rounded-lg border bg-background flex-shrink-0">
              <div className="px-4 py-2.5 border-b text-sm font-medium text-foreground flex items-center justify-between">
                <span>待导入（{stagedFiles.length}）</span>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setStagedFiles([])}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  清空
                </button>
              </div>
              <ul className="max-h-48 overflow-y-auto divide-y">
                {stagedFiles.map((file, index) => (
                  <li
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="px-4 py-2 flex items-center gap-3 text-sm"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => removeStagedFile(index)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                      aria-label={`移除 ${file.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 mt-6 flex-shrink-0 flex-wrap">
            <button
              type="button"
              disabled={importing || stagedFiles.length === 0}
              onClick={() => void importStagedFiles()}
              className="px-8 py-2 rounded bg-red-500 text-white text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {importing ? "解析中…" : "导入估值表"}
            </button>
            <button
              type="button"
              onClick={() => openValuationAnalysisPage(selectedFund.beian_hao)}
              className="px-6 py-2 rounded border text-sm text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5"
            >
              <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />
              打开估值表页
            </button>
            <button
              type="button"
              onClick={clearSelectedFund}
              className="px-6 py-2 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              返回列表
            </button>
          </div>

          {message && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-4 text-center">{message}</p>
          )}
          {error && <p className="text-sm text-red-500 mt-4 text-center">{error}</p>}

          <p className="text-xs text-muted-foreground mt-auto pt-8 flex-shrink-0">
            备注: 每次最多只能报 <span className="text-red-500 font-medium">100份</span>{" "}
            估值表，请上传交易日数据。导入成功后可点「打开估值表页」立即核对。
          </p>
        </div>
      )}
    </div>
  )
}
