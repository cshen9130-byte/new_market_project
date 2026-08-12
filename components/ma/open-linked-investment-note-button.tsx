"use client"

import { StickyNote } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"

export function OpenLinkedInvestmentNoteButton({
  onClick,
  hasNote,
  noteTitle,
}: {
  onClick: () => void
  hasNote: boolean
  noteTitle?: string
}) {
  const title = noteTitle?.trim() || "投资笔记"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={!hasNote}
          className={[
            "relative p-1 rounded transition-colors",
            hasNote
              ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              : "text-muted-foreground/40 cursor-not-allowed",
          ].join(" ")}
        >
          <StickyNote className={["h-3.5 w-3.5", hasNote ? "fill-amber-100" : ""].join(" ")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-xs">
        {hasNote ? `打开关联投资笔记：${title}` : "暂无关联投资笔记"}
      </TooltipContent>
    </Tooltip>
  )
}
