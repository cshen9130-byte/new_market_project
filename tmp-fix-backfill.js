const fs = require("fs")
const path = "scripts/ma/backfill_external_note_associations.ts"
let s = fs.readFileSync(path, "utf8")
s = s.replace(
  `const notes = listServerInvestmentNotes("team", EXTERNAL_NOTE_AUTHOR).filter((note) =>
    isExternalInvestmentNote({ ...note, creatorId: EXTERNAL_NOTE_AUTHOR }),
  )`,
  `const notes = listServerInvestmentNotes("team", EXTERNAL_NOTE_AUTHOR).filter((note) =>
    isExternalInvestmentNote(note),
  )`,
)
s = s.replace(
  `allowTextFallback: textFallback || (note.extractedProducts?.length ?? 0) === 0,`,
  `allowTextFallback: true,`,
)
// keep --text-fallback flag documented but always on for external backfill; still accept the flag for clarity
fs.writeFileSync(path, s, "utf8")
console.log("fixed filter", s.includes("isExternalInvestmentNote(note)"))
console.log("always text fallback", s.includes("allowTextFallback: true"))