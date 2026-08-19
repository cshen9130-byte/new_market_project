import fs from "fs"
import { readPdfTextWithCmaps } from "@/lib/server/pdf-text"

async function main() {
  const file =
    process.env.MARKET_DASHBOARD_STORAGE_DIR
      ? `${process.env.MARKET_DASHBOARD_STORAGE_DIR}/fund-elements/jobs/1786945219956_f191d7888122e1ed.pdf`
      : "tmp/qidun_letter.pdf"
  const buffer = fs.readFileSync(file)
  console.log("file", file, "bytes", buffer.length)
  const text = await readPdfTextWithCmaps(buffer)
  console.log("text_len", text.length)
  console.log(text)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
