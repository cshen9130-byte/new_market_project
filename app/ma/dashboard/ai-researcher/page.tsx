import { Suspense } from "react"
import { AIResearcherPage } from "@/components/ai-researcher/ai-researcher-page"

export default function MAAIResearcherPage() {
  return (
    <div className="h-full">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        }
      >
        <AIResearcherPage />
      </Suspense>
    </div>
  )
}
