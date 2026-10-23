import { buildReportExport, type ReportExportFormat } from "@/lib/server/ai-researcher-report-export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: {
    markdown?: string
    title?: string
    subjectLine?: string
    managerName?: string
    format?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const markdown = String(body.markdown ?? "").trim()
  if (!markdown) {
    return new Response(JSON.stringify({ error: "报告内容为空，无法导出" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const formatRaw = String(body.format ?? "doc").toLowerCase()
  const format: ReportExportFormat = formatRaw === "pdf" ? "pdf" : "doc"
  const managerName = String(body.managerName ?? "").trim()
  const title =
    String(body.title ?? "").trim() ||
    (managerName ? `${managerName}管理人画像` : "管理人画像报告")
  const subjectLine = String(body.subjectLine ?? managerName ?? title).trim()

  try {
    const { filename, mime, buffer } = await buildReportExport({
      markdown,
      title,
      subjectLine,
      managerName: managerName || title,
      format,
    })
    const asciiName = filename.replace(/[^\x20-\x7E]+/g, "_")
    const encoded = encodeURIComponent(filename)
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "导出失败"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
