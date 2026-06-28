"use client"

import { FileWarning } from "lucide-react"

export function ValuationEmptyAnalysis({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-zinc-100 py-20 flex flex-col items-center justify-center text-center">
      <div className="mb-4 text-zinc-200">
        <FileWarning className="h-16 w-16 stroke-[1.25]" />
      </div>
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  )
}
