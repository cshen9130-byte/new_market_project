import { rankWebsiteNotes, type WebsiteNoteHit } from "@/lib/ma/investment-note-query"
import { listServerInvestmentNotes } from "@/lib/server/investment-notes"

export function searchWebsiteInvestmentNotes(userId: string, keyword: string, limit = 8): WebsiteNoteHit[] {
  const q = keyword.trim()
  if (!q) throw new Error("请提供要搜索的词")
  const id = String(userId || "").trim()
  if (!id) throw new Error("请先登录")
  const team = listServerInvestmentNotes("team", id, { includeContent: true }).map((note) => ({
    note,
    scope: "team" as const,
  }))
  const mine = listServerInvestmentNotes("mine", id, { includeContent: true }).map((note) => ({
    note,
    scope: "mine" as const,
  }))
  const byId = new Map<string, { note: (typeof team)[number]["note"]; scope: "team" | "mine" }>()
  for (const item of mine) byId.set(item.note.id, item)
  for (const item of team) byId.set(item.note.id, item)
  return rankWebsiteNotes([...byId.values()], q, limit)
}
