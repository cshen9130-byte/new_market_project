import { cn } from "@/lib/utils"

export function NavPresenceBadge({ hasNav }: { hasNav: boolean }) {
  return (
    <span
      title={hasNav ? "已入库净值" : "暂无净值"}
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-medium leading-4",
        hasNav
          ? "bg-emerald-50 text-emerald-700"
          : "bg-zinc-100 text-zinc-500",
      )}
    >
      {hasNav ? "有净值" : "无净值"}
    </span>
  )
}
