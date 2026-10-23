import fs from "fs";
import path from "path";
import { buildReportExport } from "./lib/server/ai-researcher-report-export.ts";

const md = `# 九坤投资管理人画像

## 一、公司概况
九坤投资是国内头部量化私募管理人，成立于2012年。

## 二、核心团队
- 王琛：创始人、投资总监
- 袁宇：联合创始人

| 指标 | 数值 |
| --- | --- |
| 管理规模 | 约380亿 |
| 备案号 | P1003313 |

> 本段为测试摘要。
`;

const doc = await buildReportExport({
  markdown: md,
  title: "九坤投资管理人画像",
  subjectLine: "九坤投资",
  managerName: "九坤投资",
  format: "doc",
});
const pdf = await buildReportExport({
  markdown: md,
  title: "九坤投资管理人画像",
  subjectLine: "九坤投资",
  managerName: "九坤投资",
  format: "pdf",
});
fs.mkdirSync("tmp-export-test", { recursive: true });
fs.writeFileSync(path.join("tmp-export-test", doc.filename), doc.buffer);
fs.writeFileSync(path.join("tmp-export-test", pdf.filename), pdf.buffer);
const html = doc.buffer.toString("utf8");
console.log("DOC", doc.filename, doc.buffer.length);
console.log("PDF", pdf.filename, pdf.buffer.length);
console.log("has 公司概况", html.includes("公司概况"));
console.log("has title", html.includes("九坤投资管理人画像"));
console.log("has css", html.includes("微软雅黑"));
console.log("empty cover", /<p class="cover-title"><\/p>/.test(html));
console.log("bom", doc.buffer[0] === 0xef && doc.buffer[1] === 0xbb && doc.buffer[2] === 0xbf);
const pdfText = pdf.buffer.toString("latin1");
console.log("pdf FontFile", pdfText.includes("FontFile"));
console.log("pdf Identity-H", pdfText.includes("Identity-H"));