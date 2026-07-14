"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import type { FundNavCorrectionRule } from "@/lib/fund-nav-correction-rules-types"
import { EMPTY_FUND_NAV_CORRECTION_RULE } from "@/lib/fund-nav-correction-rules-types"

type Props = {
  open: boolean
  onClose: () => void
  beianHao: string
  productName: string
  onSaved?: () => void
}

function emptyRule(beian: string, productName: string): FundNavCorrectionRule {
  return {
    ...EMPTY_FUND_NAV_CORRECTION_RULE,
    beian_hao: beian,
    product_names: productName ? [productName] : [],
  }
}

export function FundNavCorrectionRulesDialog({
  open,
  onClose,
  beianHao,
  productName,
  onSaved,
}: Props) {
  const [rule, setRule] = useState<FundNavCorrectionRule>(() => emptyRule(beianHao, productName))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState("")

  useEffect(() => {
    if (!open) return
    setError(null)
    setRule(emptyRule(beianHao, productName))
    setAliasInput("")
    setLoading(true)
    fetch(`/ma/api/fund-nav-correction-rules?code=${encodeURIComponent(beianHao)}`)
      .then((res) => res.json())
      .then((json: { rule?: FundNavCorrectionRule | null }) => {
        if (json.rule) {
          setRule(json.rule)
          setAliasInput((json.rule.product_names ?? []).join("\n"))
        }
      })
      .catch(() => setError("加载规则失败"))
      .finally(() => setLoading(false))
  }, [open, beianHao, productName])

  if (!open) return null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const product_names = aliasInput
        .split(/[\n,，;；]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await fetch("/ma/api/fund-nav-correction-rules/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule: {
            ...rule,
            beian_hao: beianHao,
            product_names,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "保存失败")
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm("确定删除该基金净值修正规则？删除后将恢复默认净值处理逻辑。")) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/ma/api/fund-nav-correction-rules/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: { beian_hao: beianHao }, delete: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "删除失败")
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-background shadow-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="font-semibold text-base">基金净值修正规则</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {productName} · {beianHao}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 text-sm">
          {loading ? (
            <div className="text-muted-foreground py-6 text-center">加载中…</div>
          ) : (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                仅影响当前基金。用于丢弃错误的历史净值，从指定日期开始使用新的净值尺度。
                其他基金不受影响。
              </p>

              <label className="block space-y-1">
                <span className="font-medium">系列起始日期</span>
                <input
                  type="date"
                  className="w-full rounded border px-3 py-2 bg-background"
                  value={rule.series_start_date}
                  onChange={(e) => setRule((r) => ({ ...r, series_start_date: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground">
                  该日期之前的净值全部丢弃
                </span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.preserve_high_nav_scale === true}
                  onChange={(e) =>
                    setRule((r) => ({ ...r, preserve_high_nav_scale: e.target.checked }))
                  }
                />
                <span>保留高净值尺度（~4+），不自动剔除收益指数尾部</span>
              </label>

              <label className="block space-y-1">
                <span className="font-medium">产品名称别名（每行一个）</span>
                <textarea
                  className="w-full rounded border px-3 py-2 bg-background min-h-[72px]"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="锐耐稳健对冲11号A类"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium">备注</span>
                <textarea
                  className="w-full rounded border px-3 py-2 bg-background min-h-[56px]"
                  value={rule.note ?? ""}
                  onChange={(e) => setRule((r) => ({ ...r, note: e.target.value }))}
                  placeholder="说明为何需要此修正"
                />
              </label>
            </>
          )}

          {error && <div className="text-destructive text-xs">{error}</div>}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={saving || loading}
          >
            删除规则
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded border text-sm hover:bg-muted"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
              onClick={handleSave}
              disabled={saving || loading || !rule.series_start_date}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
