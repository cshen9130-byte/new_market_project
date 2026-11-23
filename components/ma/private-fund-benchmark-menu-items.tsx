"use client"

import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { groupedPrivateFundBenchmarkOptions } from "@/lib/ma/private-fund-benchmark-options"

export function PrivateFundBenchmarkMenuItems({
  selectedKey,
  onSelect,
  emptyLabel = "不显示",
  includeEmpty = true,
}: {
  selectedKey: string
  onSelect: (key: string) => void
  emptyLabel?: string
  includeEmpty?: boolean
}) {
  return (
    <>
      {includeEmpty ? (
        <DropdownMenuItem
          onClick={() => onSelect("")}
          className={!selectedKey ? "font-medium text-zinc-900" : "text-zinc-600"}
        >
          {emptyLabel}
        </DropdownMenuItem>
      ) : null}
      {groupedPrivateFundBenchmarkOptions().map(({ group, options }) => (
        <div key={group}>
          <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-medium text-zinc-400">
            {group}
          </DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onClick={() => onSelect(option.key)}
              className={option.key === selectedKey ? "font-medium text-zinc-900" : "text-zinc-600"}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </div>
      ))}
    </>
  )
}
