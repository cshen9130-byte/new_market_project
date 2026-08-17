"use client"

import { FilePlus2, Loader2, StickyNote } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"

export function OpenLinkedInvestmentNoteButton({
  onClick,
  hasNote,
  noteTitle,
  loading,
}: {
  onClick: () => void
  hasNote: boolean
  noteTitle?: string
  loading?: boolean
}) {
  const title = noteTitle?.trim() || "投资笔记"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={loading}
          className={[
            "relative p-1 rounded transition-colors",
            loading
              ? "text-sky-500 cursor-wait"
              : hasNote
                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                : "text-muted-foreground hover:text-sky-600 hover:bg-sky-50",
          ].join(" ")}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : hasNote ? (
            <StickyNote className="h-3.5 w-3.5 fill-amber-100" />
          ) : (
            <FilePlus2 className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-xs">
        {loading
          ? "正在创建投资笔记…"
          : hasNote
            ? `打开关联投资笔记：${title}`
            : "从路演新建投资笔记"}
      </TooltipContent>
    </Tooltip>
  )
}
