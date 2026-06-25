import { KnowledgeBasePage } from "@/components/knowledge-base-page"
import { AIKnowledgeGuard } from "@/components/ai-knowledge-guard"

export default function MAAIKnowledgePage() {
  return (
    <AIKnowledgeGuard redirectTo="/ma/dashboard">
      <div className="pt-6">
        <KnowledgeBasePage backHref="/ma/dashboard" backLabel="返回传统看板" variant="traditional" />
      </div>
    </AIKnowledgeGuard>
  )
}