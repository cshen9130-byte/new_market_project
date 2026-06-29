"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDays, ChevronDown, Inbox, Search } from "lucide-react"

interface FundOption {
  register_number: string
  product_name: string
}

interface UnderlyingOption {
  beian_hao: string
  product_name: string
  short_name: string | null
}

const LEDGER_UPLOAD_MAX_BYTES = 3 * 1024 * 1024
const LEDGER_UPLOAD_ACCEPT = ".xlsx,.xls"
const LEDGER_TEMPLATE_PATH = "/templates/fof-ledger-batch-upload.xlsx"
const LEDGER_TEMPLATE_FILENAME = "【模版】台账管理总表批量上传台账.xlsx"

const TRANSACTION_TYPES = [
  "申购",
  "认购",
  "赎回",
  "现金分红",
  "红利转份额",
  "强制调增",
  "强制调减",
  "转换入",
  "转换出",
]

function FormLabel({ children, required = true }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-[7.5rem] text-right pt-2 leading-snug">
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

function FormHint() {
  return (
    <span
      title="确认净额 = 确认金额 - 交易费用"
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-300 text-[9px] leading-none text-zinc-400 ml-0.5 align-middle cursor-help"
    >
      ?
    </span>
  )
}

function downloadLedgerTemplate() {
  const a = document.createElement("a")
  a.href = LEDGER_TEMPLATE_PATH
  a.download = LEDGER_TEMPLATE_FILENAME
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function AddSingleLedgerDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<FundOption | null>(null)
  const [fofFundOptions, setFofFundOptions] = useState<FundOption[]>([])
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)

  const [underlyingInput, setUnderlyingInput] = useState("")
  const [underlyingSelected, setUnderlyingSelected] = useState<UnderlyingOption | null>(null)
  const [underlyingOptions, setUnderlyingOptions] = useState<UnderlyingOption[]>([])
  const [underlyingShowDropdown, setUnderlyingShowDropdown] = useState(false)
  const [underlyingLoading, setUnderlyingLoading] = useState(false)

  const [txType, setTxType] = useState("")
  const [applyDate, setApplyDate] = useState("")
  const [confirmDate, setConfirmDate] = useState("")
  const [netAmount, setNetAmount] = useState("")
  const [shares, setShares] = useState("")
  const [unitNav, setUnitNav] = useState("")
  const [fee, setFee] = useState("")
  const [remark, setRemark] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fofSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const underlyingSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    setFofFundInput("")
    setFofFundSelected(null)
    setFofFundOptions([])
    setFofFundShowDropdown(false)
    setUnderlyingInput("")
    setUnderlyingSelected(null)
    setUnderlyingOptions([])
    setUnderlyingShowDropdown(false)
    setTxType("")
    setApplyDate("")
    setConfirmDate("")
    setNetAmount("")
    setShares("")
    setUnitNav("")
    setFee("")
    setRemark("")
    setSaving(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (fofSearchRef.current) clearTimeout(fofSearchRef.current)
    fofSearchRef.current = setTimeout(() => {
      const q = fofFundInput.trim()
      fetch(`/ma/api/ops/fof-underlying/fof-funds${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
        .catch(() => setFofFundOptions([]))
    }, 200)
    return () => { if (fofSearchRef.current) clearTimeout(fofSearchRef.current) }
  }, [fofFundInput, open])

  useEffect(() => {
    if (!open) return
    if (!underlyingInput.trim()) {
      setUnderlyingOptions([])
      setUnderlyingShowDropdown(false)
      return
    }
    if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current)
    underlyingSearchRef.current = setTimeout(async () => {
      setUnderlyingLoading(true)
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(underlyingInput.trim())}`)
        const json = await res.json()
        setUnderlyingOptions(Array.isArray(json) ? json : [])
        setUnderlyingShowDropdown(true)
      } catch {
        setUnderlyingOptions([])
      } finally {
        setUnderlyingLoading(false)
      }
    }, 250)
    return () => { if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current) }
  }, [underlyingInput, open])

  async function handleSave() {
    if (!fofFundSelected) { setError("请选择FOF基金"); return }
    if (!underlyingSelected) { setError("请选择底层基金"); return }
    if (!txType) { setError("请选择交易类型"); return }
    if (!applyDate) { setError("请选择申请日期"); return }
    if (!confirmDate) { setError("请选择确认日期"); return }
    if (!netAmount.trim()) { setError("请输入确认净额"); return }
    if (!unitNav.trim()) { setError("请输入确认单位净值"); return }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/ma/api/ops/ledger/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fof_register_number: fofFundSelected.register_number,
          fof_fund_name: fofFundSelected.product_name,
          underlying_beian_hao: underlyingSelected.beian_hao,
          underlying_fund_name: underlyingSelected.short_name || underlyingSelected.product_name,
          transaction_type: txType,
          apply_date: applyDate,
          confirm_date: confirmDate,
          confirmed_amount: netAmount.trim(),
          confirmed_shares: shares.trim() || null,
          confirmed_unit_nav: unitNav.trim(),
          transaction_fee: fee.trim() || null,
          remark: remark.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "保存失败")
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b sticky top-0 bg-background z-10">
          <span className="font-semibold text-base">添加台账</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-4">
            <FormLabel>FOF基金：</FormLabel>
            <div className="flex-1 relative">
              {fofFundSelected ? (
                <div className="flex items-center justify-between h-9 border rounded px-3 bg-background">
                  <span className="text-sm truncate">{fofFundSelected.product_name}</span>
                  <button
                    type="button"
                    onClick={() => { setFofFundSelected(null); setFofFundInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
                    placeholder="请输入并选择FOF基金"
                    className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  />
                  {fofFundShowDropdown && fofFundOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setFofFundShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {fofFundOptions.map((opt) => (
                          <button
                            key={opt.register_number}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFofFundSelected(opt)
                              setFofFundInput("")
                              setFofFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors truncate"
                          >
                            {opt.product_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>底层基金：</FormLabel>
            <div className="flex-1 flex flex-col gap-0 min-w-0">
              <div className="flex items-center border rounded overflow-visible">
                <div className="relative shrink-0">
                  <select
                    defaultValue="fof"
                    className="h-9 appearance-none pl-3 pr-7 text-sm bg-muted/40 border-r text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
                  >
                    <option value="fof">FOF底层</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                </div>
                <div className="flex flex-1 items-center px-3 gap-2 min-w-0 relative">
                  {underlyingSelected ? (
                    <div className="flex flex-1 items-center justify-between h-9 min-w-0">
                      <span className="text-sm truncate">{underlyingSelected.short_name || underlyingSelected.product_name}</span>
                      <button
                        type="button"
                        onClick={() => { setUnderlyingSelected(null); setUnderlyingInput(""); setUnderlyingShowDropdown(false) }}
                        className="text-muted-foreground hover:text-foreground text-base leading-none ml-2 shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={underlyingInput}
                        onChange={(e) => { setUnderlyingInput(e.target.value); setUnderlyingSelected(null) }}
                        onFocus={() => { if (underlyingOptions.length > 0) setUnderlyingShowDropdown(true) }}
                        placeholder="请输入并选择底层基金"
                        className="flex-1 h-9 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 min-w-0"
                      />
                      {underlyingLoading
                        ? <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" /></svg>
                        : <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />}
                    </>
                  )}
                </div>
              </div>
              {underlyingShowDropdown && underlyingOptions.length > 0 && !underlyingSelected && (
                <div className="relative z-50">
                  <div className="absolute left-0 right-0 top-0 bg-background border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {underlyingOptions.map((opt) => (
                      <button
                        key={opt.beian_hao}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setUnderlyingSelected(opt)
                          setUnderlyingInput("")
                          setUnderlyingShowDropdown(false)
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                      >
                        <div className="text-sm truncate">{opt.short_name || opt.product_name}</div>
                        <div className="text-xs text-muted-foreground truncate">{opt.beian_hao}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>交易类型：</FormLabel>
            <div className="flex-1 relative">
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value)}
                className="w-full h-9 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">请选择交易类型</option>
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>申请日期：</FormLabel>
            <div className="flex-1 relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={applyDate}
                onChange={(e) => setApplyDate(e.target.value)}
                placeholder="请选择申请日期"
                className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>确认日期：</FormLabel>
            <div className="flex-1 relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={confirmDate}
                onChange={(e) => setConfirmDate(e.target.value)}
                placeholder="请选择确认日期"
                className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>
              <span className="inline-flex items-center justify-end gap-0.5">
                确认净额<FormHint />：
              </span>
            </FormLabel>
            <div className="flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                placeholder="请输入确认净额"
                className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel required={false}>确认份额：</FormLabel>
            <div className="flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="请输入确认份额"
                className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel>确认单位净值：</FormLabel>
            <div className="flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={unitNav}
                onChange={(e) => setUnitNav(e.target.value)}
                placeholder="请输入确认单位净值"
                className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel required={false}>交易费用：</FormLabel>
            <div className="flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="请输入交易费用"
                className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FormLabel required={false}>备注：</FormLabel>
            <div className="flex-1">
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="请输入备注"
                className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/20">
          <button type="button" onClick={onClose} className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}

export function BatchUploadLedgerDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean
  onClose: () => void
  onUploaded?: () => void
}) {
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchError, setBatchError] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setBatchFile(null)
    setBatchError("")
    setIsDragOver(false)
    setSaving(false)
  }, [open])

  async function handleBatchFile(file: File) {
    setBatchError("")
    if (file.size > LEDGER_UPLOAD_MAX_BYTES) {
      setBatchFile(null)
      setBatchError("文件大小不能超过3M")
      return
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!["xlsx", "xls"].includes(ext)) {
      setBatchFile(null)
      setBatchError("只能上传 Excel 文件")
      return
    }
    setBatchFile(file)
  }

  async function handleUpload() {
    if (!batchFile || saving) return
    setSaving(true)
    setBatchError("")
    try {
      const fd = new FormData()
      fd.append("file", batchFile)
      const res = await fetch("/ma/api/ops/ledger/batch-upload", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) {
        const msg =
          json.error === "no_valid_rows"
            ? "未能识别有效数据，请使用官方模板填写后上传"
            : json.error === "file_too_large"
              ? "文件大小不能超过3M"
              : json.error === "invalid_file_type"
                ? "只能上传 Excel 文件"
                : json.error ?? "上传失败"
        throw new Error(msg)
      }
      onUploaded?.()
      onClose()
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "上传失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[560px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-base">批量上传FOF台账</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div
            className={[
              "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer",
              isDragOver ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-border hover:border-red-300 hover:bg-muted/30",
            ].join(" ")}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void handleBatchFile(file)
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={LEDGER_UPLOAD_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleBatchFile(file)
                e.target.value = ""
              }}
            />
            <Inbox className="h-10 w-10 text-red-500" strokeWidth={1.25} />
            <p className="text-sm">
              将文件拖到此处，或
              <span className="text-blue-600 dark:text-blue-400">点击上传</span>
            </p>
            {batchFile && <p className="text-xs text-muted-foreground">{batchFile.name}</p>}
          </div>

          <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
            <p className="font-medium text-zinc-600 dark:text-zinc-400">说明：</p>
            <p>
              1. 请下载
              <button type="button" onClick={downloadLedgerTemplate} className="text-blue-600 dark:text-blue-400 hover:underline mx-0.5">
                FOF基金台账模版
              </button>
              ，并按照格式进行填写后上传。
            </p>
            <p>2. 日期格式为：2021/8/20。</p>
            <p>3. 上传模板中FOF基金和底层基金备案号为必填，且备案号与平台保持一致。</p>
            <p>4. 模板中不支持公式，请注意检查。</p>
          </div>

          {batchError && <p className="text-xs text-red-500">{batchError}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">
            取消
          </button>
          <button
            type="button"
            disabled={!batchFile || saving}
            onClick={() => void handleUpload()}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "上传中…" : "上传"}
          </button>
        </div>
      </div>
    </div>
  )
}
