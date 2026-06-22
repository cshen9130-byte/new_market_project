"use client"

import { Send } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"

export function AddToTeamTrackingButton({ onClick, isTracked }: { onClick: () => void; isTracked?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={[
            "relative p-1 rounded transition-colors",
            isTracked
              ? "text-red-500 hover:text-red-600 hover:bg-red-50"
              : "text-muted-foreground hover:text-blue-500 hover:bg-muted/60",
          ].join(" ")}
        >
          <Send className={["h-3.5 w-3.5", isTracked ? "fill-current" : ""].join(" ")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-xs">
        {isTracked ? "已添加到团队跟踪" : "添加到团队跟踪"}
      </TooltipContent>
    </Tooltip>
  )
}
