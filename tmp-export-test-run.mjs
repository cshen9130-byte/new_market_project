const fs = require("fs");
const path = require("path");
async function main() {
  const mod = await import("./lib/server/ai-researcher-report-export.ts");
  const md = process.env.TEST_MD;
  const doc = await mod.buildReportExport({
    markdown: md,
    title: "九坤投资管理人画像",
    subjectLine: "九坤投资",
    managerName: "九坤投资",
    format: "doc",
  });
  const pdf = await mod.buildReportExport({
    markdown: md,
    title: "九坤投资管理人画像",
    subjectLine: "九坤投资",
    managerName: "九坤投资",
    format: "pdf",
  });
  fs.mkdirSync("tmp-export-test", { recursive: true });
  fs.writeFileSync(path.join("tmp-export-test", doc.filename), doc.buffer);
  fs.writeFileSync(path.join("tmp-export-test", pdf.filename), pdf.buffer);
  console.log("DOC", doc.filename, doc.buffer.length, doc.buffer.slice(0,3).toString("hex"));
  console.log("PDF", pdf.filename, pdf.buffer.length);
  const html = doc.buffer.toString("utf8");
  console.log("has body section", html.includes("公司概况"));
  console.log("has cover title", html.includes("九坤投资管理人画像"));
  console.log("has style css", html.includes("微软雅黑"));
}
main().catch((e) => { console.error(e); process.exit(1); });
