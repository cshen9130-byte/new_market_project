import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { PDFParse } from "pdf-parse"
import { CanvasFactory, getData } from "pdf-parse/worker"

PDFParse.setWorker(getData())

const PDFJS_CMAP_DIR = path.resolve(process.cwd(), "node_modules/pdfjs-dist/cmaps")
const PDFJS_STANDARD_FONT_DIR = path.resolve(
  process.cwd(),
  "node_modules/pdfjs-dist/standard_fonts",
)

class NodeCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const file = path.join(PDFJS_CMAP_DIR, `${name}.bcmap`)
    const buf = fs.readFileSync(file)
    return { cMapData: new Uint8Array(buf), isCompressed: true }
  }
}

class NodeStandardFontDataFactory {
  async fetch({ filename }: { filename: string }) {
    const file = path.join(PDFJS_STANDARD_FONT_DIR, filename)
    return new Uint8Array(fs.readFileSync(file))
  }
}

export function pdfParseLoadOptions(buffer: Buffer) {
  return {
    data: buffer,
    CanvasFactory,
    cMapUrl: pathToFileURL(PDFJS_CMAP_DIR + path.sep).href,
    cMapPacked: true,
    CMapReaderFactory: NodeCMapReaderFactory,
    StandardFontDataFactory: NodeStandardFontDataFactory,
    useSystemFonts: true,
  }
}

function formatPdfTables(table: {
  pages?: Array<{ tables?: string[][][] }>
  mergedTables?: string[][][]
}): string {
  const grids = [
    ...(table.pages ?? []).flatMap((page) => page.tables ?? []),
    ...(table.mergedTables ?? []),
  ]
  const parts: string[] = []
  for (const grid of grids) {
    if (!grid?.length) continue
    parts.push(
      grid
        .map((row) => row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()).join("\t"))
        .join("\n"),
    )
  }
  return parts.join("\n\n").trim()
}

/** CID/Chinese PDFs need CMaps; form/table PDFs often have no usable getText() output. */
export async function readPdfTextWithCmaps(buffer: Buffer): Promise<string> {
  const parser = new PDFParse(pdfParseLoadOptions(buffer))
  try {
    const parsed = await parser.getText()
    let tableText = ""
    try {
      tableText = formatPdfTables(await parser.getTable())
    } catch {
      tableText = ""
    }
    const body = String(parsed.text || "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    return [body, tableText].filter(Boolean).join("\n\n").trim()
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
