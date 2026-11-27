export type BriefingNavPoint = {
  date: string
  nav: number
  cumCapital: number
  dailyReturn: number
}

export function pickBriefingPoint(points: BriefingNavPoint[], date?: string): BriefingNavPoint | null {
  const rows = points.filter((point) => point.date)
  if (rows.length === 0) return null
  const wanted = (date || "").trim()
  if (!wanted) return rows[rows.length - 1]
  return rows.find((point) => point.date.slice(0, 10) === wanted.slice(0, 10)) ?? null
}

export function briefingYearReturn(points: BriefingNavPoint[], latest: BriefingNavPoint): number | null {
  const yearStart = `${latest.date.slice(0, 4)}-01-01`
  const first = points.find((point) => point.date >= yearStart) ?? points[0]
  if (!first || first.nav <= 0 || latest.nav <= 0) return null
  return latest.nav / first.nav - 1
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function scaleText(capital: number): string {
  if (!Number.isFinite(capital)) return "—"
  if (capital >= 1e8) return `${(capital / 1e8).toFixed(2)}亿元`
  if (capital >= 1e4) return `${(capital / 1e4).toFixed(2)}万元`
  return `${capital.toFixed(2)}元`
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const shown = (value * 100).toFixed(2)
  return `${value > 0 ? "+" : ""}${shown}%`
}

export function buildMomBriefingHtml(input: {
  points: BriefingNavPoint[]
  latest: BriefingNavPoint
  pageUrl: string
  title?: string
  kicker?: string
  fileTitle?: string
}): string {
  const title = input.title || "MOM 风控简报"
  const kicker = input.kicker || "MOM PORTFOLIO MANAGEMENT"
  const fileTitle = input.fileTitle || title.replace(/\s+/g, "")
  const ytd = briefingYearReturn(input.points, input.latest)
  const recent = input.points.slice(-10).reverse()
  const rows = recent.map((point) => (
    `<tr><td>${esc(point.date.slice(0, 10))}</td><td>${esc(pct(point.dailyReturn))}</td><td>${esc(point.nav.toFixed(4))}</td><td>${esc(Math.round(point.cumCapital).toLocaleString("zh-CN"))}</td></tr>`
  )).join("")
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(fileTitle)}-${esc(input.latest.date.slice(0, 10))}</title>
<style>
  body { margin: 0; background: #f3efe3; color: #1a3a5c; font-family: "Noto Serif SC", "Source Han Serif SC", SimSun, serif; }
  main { width: 794px; margin: 24px auto; background: linear-gradient(160deg,#fdfcf7,#f3efe3); min-height: 1123px; box-shadow: 0 12px 40px rgba(0,0,0,.12); }
  .bar { height: 8px; background: linear-gradient(90deg,#1a3a5c,#c8a84b,#1a3a5c); }
  .pad { padding: 28px 40px 48px; }
  h1 { margin: 0; font-size: 40px; letter-spacing: -0.01em; }
  .gold { height: 3px; margin: 16px 0 24px; background: linear-gradient(90deg,#c8a84b,#e8d48b,#c8a84b); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .card { border: 1px solid #d4c9a8; background: #fff; padding: 14px 16px; }
  .label { font-size: 12px; color: #5a6a7a; }
  .value { margin-top: 6px; font-size: 28px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; background: #fff; }
  th, td { border-bottom: 1px solid #eadfc4; padding: 8px 10px; text-align: right; font-size: 14px; }
  th:first-child, td:first-child { text-align: left; }
  a { color: #1a3a5c; }
  .foot { margin-top: 28px; font-size: 12px; color: #5a6a7a; }
</style>
</head>
<body>
<main>
  <div class="bar"></div>
  <div class="pad">
    <p class="label">${esc(kicker)}</p>
    <h1>${esc(title)}</h1>
    <p class="label">每日风险与业绩速览 · ${esc(input.latest.date.slice(0, 10))}</p>
    <div class="gold"></div>
    <h2>一、当日预估收益</h2>
    <div class="stats">
      <div class="card"><div class="label">当日预估收益率</div><div class="value">${esc(pct(input.latest.dailyReturn))}</div></div>
      <div class="card"><div class="label">当年累计收益率</div><div class="value">${esc(pct(ytd))}</div></div>
      <div class="card"><div class="label">最新单位净值</div><div class="value">${esc(input.latest.nav.toFixed(4))}</div></div>
      <div class="card"><div class="label">总规模</div><div class="value">${esc(scaleText(input.latest.cumCapital))}</div></div>
    </div>
    <h2>最近交易日</h2>
    <table>
      <thead><tr><th>日期</th><th>当日收益</th><th>净值</th><th>累计净资本</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="foot">本简报仅供内部参考，不构成投资建议。带图表的完整页面：<a href="${esc(input.pageUrl)}">${esc(input.pageUrl)}</a></p>
  </div>
</main>
</body>
</html>`
}
