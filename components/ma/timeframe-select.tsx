"use client"

import { TIMEFRAMES, type TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

type Props = {
  value: TimeframeId
  onChange: (id: TimeframeId) => void
  className?: string
  dark?: boolean
}

export function TimeframeSelect({ value, onChange, className, dark }: Props) {
  return (
    <div className={cn("flex flex-wrap gap-0.5", className)}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.id}
          type="button"
          onClick={() => onChange(tf.id)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] tabular-nums",
            dark
              ? value === tf.id
                ? "bg-[#4c84ff] text-white"
                : "text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
              : value === tf.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {tf.label}
        </button>
      ))}
    </div>
  )
}
