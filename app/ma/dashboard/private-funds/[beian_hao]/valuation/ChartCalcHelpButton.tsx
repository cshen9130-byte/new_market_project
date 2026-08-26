"use client"

import { HelpCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type ChartCalcHelpBlock = {
  title: string
  paragraphs?: string[]
  formula?: string
  bullets?: string[]
}

export type ChartCalcHelp = {
  heading?: string
  blocks: ChartCalcHelpBlock[]
}

export function ChartCalcHelpButton({
  heading,
  blocks,
  className,
}: {
  heading: string
  blocks: ChartCalcHelpBlock[]
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={[
            "inline-flex items-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0",
            className ?? "",
          ].join(" ")}
          aria-label={`${heading}计算说明`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[24rem] max-h-[70vh] overflow-y-auto p-3.5 text-xs leading-relaxed text-zinc-600"
      >
        <div className="font-semibold text-zinc-800 mb-2">{heading}</div>
        <div className="space-y-3">
          {blocks.map((block) => (
            <section key={block.title} className="space-y-1.5">
              <h4 className="font-semibold text-zinc-800">{block.title}</h4>
              {block.paragraphs?.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {block.formula ? (
                <p className="rounded bg-zinc-50 px-2.5 py-2 font-mono text-[11px] text-zinc-700 tabular-nums whitespace-pre-wrap">
                  {block.formula}
                </p>
              ) : null}
              {block.bullets?.length ? (
                <ul className="list-disc space-y-1 pl-4">
                  {block.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
