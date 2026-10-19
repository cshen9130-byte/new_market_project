const fs = require("fs")
const path = "scripts/ma/backfill_external_note_associations.ts"
let s = fs.readFileSync(path, "utf8")

// Prefer extracted-only by default; --text-fallback enables body parse when no matched extract.
s = s.replace(
  `allowTextFallback: true,`,
  `allowTextFallback: textFallback,`,
)

// Better: auto text fallback only when matched extracted is empty, unless --no-text-fallback
if (!s.includes("associationsFromMatchedExtractedProducts(note.extractedProducts)")) {
  s = s.replace(
`  const {
    EXTERNAL_NOTE_AUTHOR,
    isExternalInvestmentNote,
    mergeInvestmentNoteAssociations,
    resolveAutoAssociationsForNote,
  } = await import("@/lib/server/investment-note-auto-associate")`,
`  const {
    EXTERNAL_NOTE_AUTHOR,
    associationsFromMatchedExtractedProducts,
    isExternalInvestmentNote,
    mergeInvestmentNoteAssociations,
    resolveAutoAssociationsForNote,
  } = await import("@/lib/server/investment-note-auto-associate")`,
  )
  s = s.replace(
    `allowTextFallback: textFallback,`,
    `allowTextFallback:
        textFallback || associationsFromMatchedExtractedProducts(note.extractedProducts).length === 0,`,
  )
}

// add --no-text-fallback support
if (!s.includes("noTextFallback")) {
  s = s.replace(
    `const textFallback = process.argv.includes("--text-fallback")`,
    `const noTextFallback = process.argv.includes("--no-text-fallback")\n  const textFallback = process.argv.includes("--text-fallback") && !noTextFallback`,
  )
  s = s.replace(
    `allowTextFallback:
        textFallback || associationsFromMatchedExtractedProducts(note.extractedProducts).length === 0,`,
    `allowTextFallback: noTextFallback
        ? false
        : textFallback ||
          associationsFromMatchedExtractedProducts(note.extractedProducts).length === 0,`,
  )
}

fs.writeFileSync(path, s, "utf8")
console.log(s.match(/allowTextFallback:[\s\S]{0,180}/)?.[0])