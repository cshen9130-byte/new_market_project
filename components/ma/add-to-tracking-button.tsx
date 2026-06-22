"use client"

import { Heart, Plus } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"

export function AddToTrackingButton({ onClick, isTracked }: { onClick: () => void; isTracked?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={[
            "relative p-1 rounded transition-colors",
            isTracked
              ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50"
              : "text-muted-foreground hover:text-rose-500 hover:bg-muted/60",
          ].join(" ")}
        >
          <Heart className={["h-3.5 w-3.5", isTracked ? "fill-current" : ""].join(" ")} />
          {!isTracked && (
            <Plus className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-current stroke-[3]" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="text-xs">
        {isTracked ? "已添加到我的跟踪" : "添加到我的跟踪"}
      </TooltipContent>
    </Tooltip>
  )
}
