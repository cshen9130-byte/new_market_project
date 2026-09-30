port { describe, expect, it } from "vitest"
import {
  associationsFromMatchedExtractedProducts,
  mergeInvestmentNoteAssociations,
} from "@/lib/server/investment-note-auto-associate"

describe("investment-note-auto-associate", () => {
  it("promotes only matched/applied products with register codes", () => {
    const rows = associationsFromMatchedExtractedProducts([
      { name: "A", recordNo: "SES717", confidence: "matched" },
      { name: "B", recordNo: "SEA491", confidence: "applied" },
      { name: "C", recordNo: "XXX", confidence: "extracted" },
      { name: "D series", recordNo: "", confidence: "matched" },
    ])
    expect(rows.map((r) => r.recordNo).sort()).toEqual(["SEA491", "SES717"])
    expect(rows.every((r) => r.category === "私募基金")).toBe(true)
  })

  it("merges without dropping existing manual associations", () => {
    const merged = mergeInvestmentNoteAssociations(
      [{ category: "私募基金", name: "Manual", recordNo: "M1" }],
      [{ category: "私募基金", name: "Auto", recordNo: "A1" }],
    )
    expect(merged).toHaveLength(2)
    expect(merged.map((r) => r.recordNo).sort()).toEqual(["A1", "M1"])
  })
})
