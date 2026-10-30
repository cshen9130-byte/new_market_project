"use client"

import { IV_LOOKBACKS, type IvLookbackDays } from "@/lib/client/iv-lookback"
import { cn } from "@/lib/utils"

type Props = {
  value: IvLookbackDays
  onChange: (days: IvLookbackDays) => void
  className?: string
  dark?: boolean
}

/** X-axis session-window length (separate from bar interval). Mirrors TimeframeSelect styling. */
export function IvLookbackSelect({ value, onChange, className, dark }: Props) {
  return (
    <div className={cn("flex flex-wrap gap-0.5", className)} title="横轴天数">
      {IV_LOOKBACKS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] tabular-nums",
            dark
              ? value === item.id
                ? "bg-[#4c84ff] text-white"
                : "text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
              : value === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
