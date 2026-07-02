"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { createPortal } from "react-dom"

const DEFAULT_TEAM_POOLS = [
  { key: "bfl_ops", label: "bfl 运维池" },
  { key: "bfl", label: "bfl跟踪池" },
  { key: "jy_ops", label: "JY运维池" },
  { key: "jy", label: "JY跟踪池" },
]

const DEFAULT_MINE_POOLS = [
  { key: "mine_default", label: "默认我的跟踪" },
]

function mergePoolOptions(
  base: { key: string; label: string }[],
  incoming: { pool_key: string; label: string }[],
): { key: string; label: string }[] {
  const merged = [...base]
  for (const p of incoming) {
    if (!p?.pool_key || merged.some((m) => m.key === p.pool_key)) continue
    merged.push({ key: p.pool_key, label: p.label })
  }
  return merged
}

function currentUserId(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.id ?? ""
  } catch {
    return ""
  }
}

function currentUserName(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name || u?.email || ""
  } catch {
    return ""
  }
}

function userFetchHeaders(): Record<string, string> {
  const id = currentUserId()
  return id ? { "x-market-user-id": id } : {}
}

function personalTagsSettingsUrl() {
  return "/ma/dashboard/settings?section=personal-tags&category=fund"
}

export function AddMyTrackingDialog({
  open,
  beian_hao,
  product_name,
  onClose,
  onSaved,
}: {
  open: boolean
  beian_hao: string
  product_name: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [teamPoolsSelected, setTeamPoolsSelected] = useState<string[]>([])
  const [teamPoolOptions, setTeamPoolOptions] = useState(DEFAULT_TEAM_POOLS)
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [poolPickerPos, setPoolPickerPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const poolFieldRef = useRef<HTMLDivElement>(null)

  const [minePool, setMinePool] = useState("mine_default")
  const [minePools, setMinePools] = useState(DEFAULT_MINE_POOLS)

  const [teamTagsSelected, setTeamTagsSelected] = useState<string[]>([])
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [tagPickerPos, setTagPickerPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const tagFieldRef = useRef<HTMLDivElement>(null)

  const [personalTagsSelected, setPersonalTagsSelected] = useState<string[]>([])
  const [personalTagOptions, setPersonalTagOptions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) return
    setTeamPoolsSelected([])
    setMinePool("mine_default")
    setTeamTagsSelected([])
    setPersonalTagsSelected([])
    setError(null)
    setShowPoolPicker(false)
    setShowTagPicker(false)

    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setTeamTagOptions(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})

    fetch("/ma/api/tracking-funds/pools?scope=team")
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.data)) return
        setTeamPoolOptions(mergePoolOptions(DEFAULT_TEAM_POOLS, d.data))
      })
      .catch(() => {})

    const owner = encodeURIComponent(currentUserName())
    fetch(`/ma/api/ops/team-tags?category=fund_personal&owner=${owner}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setPersonalTagOptions(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})

    fetch("/ma/api/tracking-funds/pools?scope=mine", { headers: userFetchHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.data)) return
        setMinePools(mergePoolOptions(
          DEFAULT_MINE_POOLS,
          d.data.filter((p: { pool_key: string }) => p.pool_key !== "mine_all"),
        ))
      })
      .catch(() => {})
  }, [open, beian_hao])

  function openPoolPicker(e: React.MouseEvent) {
    e.stopPropagation()
    const el = poolFieldRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPoolPickerPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
    window.setTimeout(() => setShowPoolPicker(true), 0)
  }

  function openTagPicker(e: React.MouseEvent) {
    e.stopPropagation()
    const el = tagFieldRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setTagPickerPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
    window.setTimeout(() => setShowTagPicker(true), 0)
  }

  function toggleTeamPool(key: string) {
    setTeamPoolsSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  function teamPoolLabel(key: string) {
    return teamPoolOptions.find((p) => p.key === key)?.label ?? key
  }

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      const poolsToAdd = [...teamPoolsSelected]
      if (minePool && !poolsToAdd.includes(minePool)) poolsToAdd.push(minePool)

      await Promise.all(
        poolsToAdd.map((pool) =>
          fetch("/ma/api/tracking-funds/add", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...userFetchHeaders() },
            body: JSON.stringify({ pool, beian_hao, product_name }),
          }).then((r) => r.json()),
        ),
      )

      if (teamTagsSelected.length > 0) {
        await fetch("/ma/api/tracking-funds/fund-tags", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beian_hao, tags: teamTagsSelected }),
        })
      }

      if (personalTagsSelected.length > 0) {
        await fetch("/ma/api/tracking-funds/personal-fund-tags", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...userFetchHeaders() },
          body: JSON.stringify({ beian_hao, tags: personalTagsSelected }),
        })
      }

      onSaved?.()
      onClose()
    } catch {
      setError("网络错误，请重试")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const labelW = "w-24 shrink-0 text-right text-sm whitespace-nowrap"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">添加我的跟踪</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Fund name */}
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
            <span className="font-semibold text-sm">{product_name}</span>
          </div>

          {/* 产品池 */}
          <div className="flex items-center gap-3">
            <span className={labelW}>产品池：</span>
            <div
              ref={poolFieldRef}
              className="flex flex-1 items-center border rounded px-3 min-h-[36px] gap-1.5 flex-wrap py-1 cursor-pointer bg-background"
              onClick={openPoolPicker}
            >
              {teamPoolsSelected.length === 0
                ? <span className="text-sm text-muted-foreground/50 pointer-events-none">请选择产品池</span>
                : teamPoolsSelected.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                    {teamPoolLabel(key)}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleTeamPool(key) }}
                      className="hover:text-red-500 leading-none"
                    >×</button>
                  </span>
                ))
              }
            </div>
            <button
              type="button"
              onClick={() => setTeamPoolsSelected([])}
              className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0"
            >清空</button>
          </div>

          {/* 个人产品池 */}
          <div className="flex items-center gap-3">
            <span className={labelW}>个人产品池：</span>
            <div className="relative flex-1">
              <select
                value={minePool}
                onChange={(e) => setMinePool(e.target.value)}
                className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300"
              >
                {minePools.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            </div>
          </div>

          {/* 标签 */}
          <div className="flex items-center gap-3">
            <span className={labelW}>标签：</span>
            <div
              ref={tagFieldRef}
              className="flex flex-1 items-center border rounded px-3 min-h-[36px] gap-1.5 flex-wrap py-1 cursor-pointer bg-background"
              onClick={openTagPicker}
            >
              {teamTagsSelected.length === 0
                ? <span className="text-sm text-muted-foreground/50 pointer-events-none">请选择标签</span>
                : teamTagsSelected.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                    {t}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setTeamTagsSelected((p) => p.filter((x) => x !== t)) }}
                      className="hover:text-red-500 leading-none"
                    >×</button>
                  </span>
                ))
              }
            </div>
            <button
              type="button"
              onClick={() => setTeamTagsSelected([])}
              className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0"
            >清空</button>
          </div>

          {/* 个人标签 */}
          <div className="flex items-center gap-3">
            <span className={labelW}>个人标签：</span>
            <div className="flex flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto bg-muted/30 rounded px-3 py-2 min-w-0">
              {personalTagOptions.length === 0 && (
                <span className="text-sm text-muted-foreground flex-shrink-0">个人标签</span>
              )}
              {personalTagOptions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setPersonalTagsSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                  className={[
                    "inline-flex shrink-0 items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                    personalTagsSelected.includes(tag)
                      ? "bg-red-50 text-red-500 border-red-300"
                      : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  {tag}
                </button>
              ))}
              <button
                type="button"
                onClick={() => window.open(personalTagsSettingsUrl(), "_blank")}
                className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                设置
              </button>
              <button
                type="button"
                onClick={() => {
                  const owner = encodeURIComponent(currentUserName())
                  fetch(`/ma/api/ops/team-tags?category=fund_personal&owner=${owner}`)
                    .then((r) => r.json())
                    .then((d) => Array.isArray(d) ? setPersonalTagOptions(d.map((t: { name: string }) => t.name)) : null)
                    .catch(() => {})
                }}
                className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                刷新
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-3 border-t flex-shrink-0">
          {error && <p className="text-xs text-red-500 text-right">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              取 消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleConfirm()}
              className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "保存中…" : "确 定"}
            </button>
          </div>
        </div>
      </div>

      {/* Pool picker portal */}
      {mounted && showPoolPicker && poolPickerPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={(e) => { e.stopPropagation(); setShowPoolPicker(false) }}
          />
          <div
            className="fixed z-[201] bg-background border rounded-lg shadow-lg p-2 flex flex-nowrap gap-1.5 overflow-x-auto"
            style={{ top: poolPickerPos.top, left: poolPickerPos.left, width: poolPickerPos.width }}
            onClick={(e) => e.stopPropagation()}
          >
            {teamPoolOptions.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleTeamPool(p.key) }}
                className={[
                  "inline-flex shrink-0 items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                  teamPoolsSelected.includes(p.key)
                    ? "bg-red-50 text-red-500 border-red-300"
                    : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* Tag picker portal */}
      {mounted && showTagPicker && tagPickerPos && teamTagOptions.length > 0 && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={(e) => { e.stopPropagation(); setShowTagPicker(false) }}
          />
          <div
            className="fixed z-[201] bg-background border rounded-lg shadow-lg p-2 flex flex-wrap gap-1.5"
            style={{ top: tagPickerPos.top, left: tagPickerPos.left, width: tagPickerPos.width }}
            onClick={(e) => e.stopPropagation()}
          >
            {teamTagOptions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setTeamTagsSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])
                }}
                className={[
                  "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                  teamTagsSelected.includes(tag)
                    ? "bg-red-50 text-red-500 border-red-300"
                    : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {tag}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
