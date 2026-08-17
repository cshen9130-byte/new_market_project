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

/** CID/Chinese PDFs need CMaps; without them pdf.js often returns only page markers. */
export async function readPdfTextWithCmaps(buffer: Buffer): Promise<string> {
  const parser = new PDFParse(pdfParseLoadOptions(buffer))
  try {
    const parsed = await parser.getText()
    return String(parsed.text || "").replace(/\s+/g, " ").trim()
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
