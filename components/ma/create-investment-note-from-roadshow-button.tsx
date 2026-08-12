"use client"

import { FilePlus2, Loader2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"

export function CreateInvestmentNoteFromRoadshowButton({
  onClick,
  loading,
}: {
  onClick: () => void
  loading?: boolean
}) {
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
              : "text-muted-foreground hover:text-sky-600 hover:bg-sky-50",
          ].join(" ")}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FilePlus2 className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-xs">
        {loading ? "正在创建投资笔记…" : "从路演新建投资笔记"}
      </TooltipContent>
    </Tooltip>
  )
}
