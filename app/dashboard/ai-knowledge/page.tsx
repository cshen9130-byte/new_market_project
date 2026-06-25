import { KnowledgeBasePage } from "@/components/knowledge-base-page"
import { AIKnowledgeGuard } from "@/components/ai-knowledge-guard"

export default function AIKnowledgePage() {
  return (
    <AIKnowledgeGuard redirectTo="/dashboard">
      <KnowledgeBasePage backHref="/dashboard" backLabel="返回仪表盘" />
    </AIKnowledgeGuard>
  )
}