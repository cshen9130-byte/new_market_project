**
 * Backfill 私募基金 links (关联产品) on existing 外部笔记 notes from catalog-matched
 * extractedProducts (and optionally title/body text when no matched extract exists).
 *
 * Precision: only confidence matched/applied with a non-empty 备案号.
 * Existing manual associations are kept (merge, never remove).
 * Writes notes.json once at the end (batched).
 *
 *   npx tsx scripts/ma/backfill_external_note_associations.ts --dry-run
 *   npx tsx scripts/ma/backfill_external_note_associations.ts --no-text-fallback
 *   npx tsx scripts/ma/backfill_external_note_associations.ts --limit=20
 *   npx tsx scripts/ma/backfill_external_note_associations.ts
 */

import { readFileSync, writeFileSync } from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
import { getServerStoragePath } from "@/lib/server/storage"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

function parseLimit(argv: string[]): number | undefined {
  const raw = argv.find((arg) => arg.startsWith("--limit="))
  if (!raw) return undefined
  const n = Number(raw.slice("--limit=".length))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function notesPath() {
  return path.join(getServerStoragePath("investment-notes"), "notes.json")
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const noTextFallback = process.argv.includes("--no-text-fallback")
  const textFallbackFlag = process.argv.includes("--text-fallback")
  const limit = parseLimit(process.argv)

  const {
    EXTERNAL_NOTE_AUTHOR,
    associationsFromMatchedExtractedProducts,
    isExternalInvestmentNote,
    mergeInvestmentNoteAssociations,
    resolveAutoAssociationsForNote,
  } = await import("@/lib/server/investment-note-auto-associate")
  const { associationKey } = await import("@/lib/ma/investment-notes")

  const file = notesPath()
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown[]
  if (!Array.isArray(raw)) throw new Error("notes.json is not an array")

  let scanned = 0
  let linked = 0
  let skippedHasAssoc = 0
  let skippedNoMatch = 0
  let fromExtractedTotal = 0
  let fromTextTotal = 0
  let changed = false
  const samples: Array<{ title: string; added: number; codes: string[] }> = []

  for (let i = 0; i < raw.length; i += 1) {
    if (limit !== undefined && linked >= limit) break
    const note = raw[i] as Record<string, any>
    if (!note || typeof note !== "object") continue
    if (!isExternalInvestmentNote({ creator: String(note.creator || ""), creatorId: String(note.creatorId || "") })) {
      continue
    }
    scanned += 1

    const existing = Array.isArray(note.associations) ? note.associations : []
    // Fast path: already linked notes need no work unless --force re-merge.
    if (existing.length > 0 && !process.argv.includes("--force")) {
      skippedHasAssoc += 1
      continue
    }
    const extractedProducts = Array.isArray(note.extractedProducts) ? note.extractedProducts : []
    const allowTextFallback = noTextFallback
      ? false
      : textFallbackFlag || associationsFromMatchedExtractedProducts(extractedProducts).length === 0

    const resolved = await resolveAutoAssociationsForNote({
      title: String(note.title || ""),
      content: String(note.content || ""),
      extractedProducts,
      allowTextFallback,
    })
    const merged = mergeInvestmentNoteAssociations(existing, resolved.associations)
    const existingKeys = new Set(existing.map((item: any) => associationKey(item)))
    const addedItems = merged.filter((item) => !existingKeys.has(associationKey(item)))
    if (addedItems.length === 0) {
      if (existing.length > 0) skippedHasAssoc += 1
      else skippedNoMatch += 1
      continue
    }

    fromExtractedTotal += resolved.fromExtracted
    fromTextTotal += resolved.fromText
    linked += 1
    if (samples.length < 12) {
      samples.push({
        title: String(note.title || ""),
        added: addedItems.length,
        codes: addedItems.map((item) => item.recordNo || item.name).slice(0, 6),
      })
    }

    console.error(
      `[${dryRun ? "dry-run" : "linked"}] ${String(note.title || "").slice(0, 60)} +|${addedItems.length} extracted=${resolved.fromExtracted} text=${resolved.fromText}`,
    )

    if (!dryRun) {
      note.associations = merged
      raw[i] = note
      changed = true
    }
  }

  if (!dryRun && changed) {
    writeFileSync(file, JSON.stringify(raw), "utf8")
    console.error(`[write] ${file}`)
  }

  console.error(
    JSON.stringify(
      {
        dryRun,
        noTextFallback,
        scanned,
        linked,
        skippedHasAssoc,
        skippedNoMatch,
        fromExtractedTotal,
        fromTextTotal,
        samples,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
