import { Suspense } from "react"
import { KnowledgeBasePage } from "@/components/knowledge-base-page"
import { AIKnowledgeGuard } from "@/components/ai-knowledge-guard"

export default function AIKnowledgePage() {
  return (
    <AIKnowledgeGuard redirectTo="/dashboard">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        }
      >
        <KnowledgeBasePage backHref="/dashboard" backLabel="返回仪表盘" />
      </Suspense>
    </AIKnowledgeGuard>
  )
}