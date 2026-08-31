"use client"

import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function StrategyL3MultiSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  value: string[]
  onChange: (next: string[]) => void
  options: string[]
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const allOptions = useMemo(() => {
    const extra = value.filter((item) => !options.includes(item))
    return [...options, ...extra]
  }, [options, value])

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag])
  }

  function remove(tag: string) {
    onChange(value.filter((item) => item !== tag))
  }

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => { if (!disabled) setOpen(next) }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="relative w-full min-h-[36px] appearance-none rounded border border-border bg-background pl-2 pr-8 py-1 text-left text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <span className="flex flex-wrap items-center gap-1">
            {value.length === 0 ? (
              <span className="pl-1 py-0.5 text-zinc-400">{placeholder}</span>
            ) : (
              value.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {tag}
                  <span
                    role="button"
                    tabIndex={0}
                    className="leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      remove(tag)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        remove(tag)
                      }
                    }}
                    aria-label={`移除 ${tag}`}
                  >
                    ×
                  </span>
                </span>
              ))
            )}
          </span>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[80] w-[var(--radix-popover-trigger-width)] p-1"
      >
        {allOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm text-zinc-400">暂无三级策略</div>
        ) : (
          allOptions.map((opt) => {
            const checked = value.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 hover:bg-muted dark:text-zinc-200"
              >
                <span
                  className={[
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] leading-none",
                    checked
                      ? "border-red-500 bg-red-500 text-white"
                      : "border-zinc-300 bg-background dark:border-zinc-600",
                  ].join(" ")}
                >
                  {checked ? "✓" : ""}
                </span>
                {opt}
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
