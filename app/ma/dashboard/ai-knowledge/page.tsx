import { Suspense } from "react"
import { KnowledgeBasePage } from "@/components/knowledge-base-page"
import { AIKnowledgeGuard } from "@/components/ai-knowledge-guard"

export default function MAAIKnowledgePage() {
  return (
    <AIKnowledgeGuard redirectTo="/ma/dashboard">
      <div className="pt-6">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          }
        >
          <KnowledgeBasePage backHref="/ma/dashboard" backLabel="返回传统看板" variant="traditional" />
        </Suspense>
      </div>
    </AIKnowledgeGuard>
  )
}