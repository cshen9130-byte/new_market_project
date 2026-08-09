"use client"

import * as React from "react"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Native `<input type="date">` empty-state text is locale-controlled and cannot
 * be overridden with `placeholder`. On zh-CN Windows Chrome it often shows the
 * broken hint `yyyy/mm/日`. Always use this component for date fields.
 *
 * See: docs/date-input-locale-placeholder.md
 */
export function DateInput({
  value,
  onChange,
  placeholder = "请选择日期",
  className,
  inputClassName,
  displayClassName,
  disabled,
  id,
  name,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  displayClassName?: string
  disabled?: boolean
  id?: string
  name?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => {
          if (!disabled) inputRef.current?.showPicker?.()
        }}
        className={cn(
          "h-9 w-full rounded border border-border bg-background px-3 pr-9 text-sm",
          "text-transparent caret-transparent",
          "[&::-webkit-datetime-edit]:text-transparent",
          "[&::-webkit-datetime-edit-fields-wrapper]:text-transparent",
          "[&::-webkit-datetime-edit-text]:text-transparent",
          "[&::-webkit-datetime-edit-year-field]:text-transparent",
          "[&::-webkit-datetime-edit-month-field]:text-transparent",
          "[&::-webkit-datetime-edit-day-field]:text-transparent",
          "[&::-webkit-calendar-picker-indicator]:absolute",
          "[&::-webkit-calendar-picker-indicator]:inset-0",
          "[&::-webkit-calendar-picker-indicator]:h-full",
          "[&::-webkit-calendar-picker-indicator]:w-full",
          "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
          "[&::-webkit-calendar-picker-indicator]:opacity-0",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          inputClassName,
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 z-10 max-w-[calc(100%-2.25rem)] -translate-y-1/2 truncate text-sm",
          value ? "text-foreground" : "text-muted-foreground/70",
          displayClassName,
        )}
      >
        {value || placeholder}
      </span>
      <CalendarDays className="pointer-events-none absolute right-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}
