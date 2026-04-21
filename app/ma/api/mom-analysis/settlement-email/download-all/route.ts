import fs from "fs"
import path from "path"
import AdmZip from "adm-zip"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SETTLEMENT_DIR =
  process.env.SETTLEMENT_DOWNLOAD_DIR ??
  path.join(
    process.env.MOM_DATA_DIR
      ? path.dirname(process.env.MOM_DATA_DIR)
      : path.join(process.cwd(), "..", "mom_data"),
    "交易结算单",
  )

export async function GET() {
  if (!fs.existsSync(SETTLEMENT_DIR)) {
    return new Response("目录不存在", { status: 404 })
  }

  const zip = new AdmZip()
  zip.addLocalFolder(SETTLEMENT_DIR, "国信已下载结算单")

  const buf = zip.toBuffer()
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("国信已下载结算单.zip")}`,
      "Cache-Control": "no-store",
    },
  })
}
