/**
 * Native Excel column/bar charts for the 股票市场回顾 sheet.
 * xlsx-js-style cannot write charts, so this post-processes the xlsx zip.
 */

export type MarketBenchPoint = {
  name: string
  ret: number | null
}

export type ChartFundRow = {
  beian_hao: string
  name: string
  bucket: string
  ret_1w: number | null
}

export type WeeklyReviewMarketChartTables = {
  dataAoa: unknown[][]
  dataSheetName: string
  note: string
  chart1StartRow: number
  chart2StartRow: number | null
  chart1HeightRows: number
  chart2HeightRows: number
  commentRow: number
  chart1: BarChartSpec
  chart2: BarChartSpec | null
}

export type BarChartSpec = {
  title: string
  barDir: "col" | "bar"
  catRange: string
  valueMin?: number
  valueMax?: number
  series: Array<{
    titleCell: string
    valRange: string
    color: string
    invertIfNegative?: boolean
    showVal?: boolean
    pointColors?: Array<string | null>
  }>
}

const DATA_SHEET = "图表数据"
const NOTE =
  "上一图近一周是绝对收益，与上方指数涨跌幅同一口径。下一图每个策略用该策略表的近一周口径：指增为超额，其余为绝对收益。同一产品出现在多个来源时，计入每一个来源的中位数。没有近一周数的产品不计入。各来源的中位数、平均数、最大值、最小值、产品数和分化程度见「来源统计」。分化程度是该策略该来源下各产品本周收益的标准差，产品数少于 2 时不计算。"
const NAVY = "1F4E79"
const POOL_BAR = "C00000"
const PUBLIC_BAR = "2E75B6"
const XIAOHE_BAR = "7030A0"
const IMA_BAR = "548235"
const HELD_BAR = "C65911"

export const SOURCE_MEDIAN_SERIES = [
  { key: "pool", label: "跟踪池", color: POOL_BAR },
  { key: "xiaohe", label: "小荷公众号", color: XIAOHE_BAR },
  { key: "public", label: "公募指增", color: PUBLIC_BAR },
  { key: "ima", label: "ima点睛", color: IMA_BAR },
  { key: "held", label: "已投", color: HELD_BAR },
] as const

export type SourceMedianKey = (typeof SOURCE_MEDIAN_SERIES)[number]["key"]

export type SourceMedianMembership = {
  bucket: string
  week: number | null
} & Partial<Record<SourceMedianKey, boolean>>

/** One median per source. A product flagged on several sources is counted in each. */
export function sourceMedianRows(
  rows: SourceMedianMembership[],
): Array<{ bucket: string; values: Array<number | null> }> {
  const buckets: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.bucket || seen.has(row.bucket)) continue
    seen.add(row.bucket)
    buckets.push(row.bucket)
  }
  return buckets
    .map((bucket) => ({
      bucket,
      values: SOURCE_MEDIAN_SERIES.map((series) => median(
        rows.filter((row) => row.bucket === bucket && row[series.key]).map((row) => row.week),
      )),
    }))
    .filter((row) => row.values.some((value) => value != null))
}

export const SOURCE_WEEK_STATS = [
  { key: "median", label: "中位数" },
  { key: "mean", label: "平均数" },
  { key: "max", label: "最大值" },
  { key: "min", label: "最小值" },
  { key: "count", label: "产品数" },
  { key: "stdev", label: "分化程度" },
] as const

export type SourceWeekStatKey = (typeof SOURCE_WEEK_STATS)[number]["key"]

export type SourceWeekStat = Record<SourceWeekStatKey, number | null> & { count: number }

/** Sample standard deviation (n-1). Blank when fewer than 2 finite values. */
export function sampleStdev(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (xs.length < 2) return null
  const mean = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const ss = xs.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return Math.sqrt(ss / (xs.length - 1))
}

function summarizeWeek(values: Array<number | null | undefined>): SourceWeekStat {
  const xs = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (xs.length === 0) return { count: 0, median: null, mean: null, max: null, min: null, stdev: null }
  return {
    count: xs.length,
    median: median(xs),
    mean: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    max: Math.max(...xs),
    min: Math.min(...xs),
    stdev: sampleStdev(xs),
  }
}

/** One stat block per source. A product flagged on several sources is counted in each. */
export function sourceWeekStatRows(
  rows: SourceMedianMembership[],
): Array<{ bucket: string; sources: SourceWeekStat[] }> {
  const buckets: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.bucket || seen.has(row.bucket)) continue
    seen.add(row.bucket)
    buckets.push(row.bucket)
  }
  return buckets
    .map((bucket) => ({
      bucket,
      sources: SOURCE_MEDIAN_SERIES.map((series) => summarizeWeek(
        rows.filter((row) => row.bucket === bucket && row[series.key]).map((row) => row.week),
      )),
    }))
    .filter((row) => row.sources.some((stat) => stat.count > 0))
}
const RED = "C00000"
const GREEN = "006600"
const ROW_PT = 22
const CHART_WIDTH_CM = 26
const CM_TO_EMU = 360000

function median(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}


function valueAxisBounds(values: Array<number | null | undefined>, extraNeg = false): { min: number; max: number } {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v))
  const lo = xs.length ? Math.min(0, ...xs) : -0.01
  const hi = xs.length ? Math.max(0, ...xs) : 0.01
  const span = Math.max(hi - lo, 0.02)
  const pad = span * 0.16
  const min = lo - (extraNeg ? Math.max(pad, Math.abs(lo) * 0.45, 0.015) : pad)
  const max = hi + pad
  return { min, max }
}

function heightRows(cm: number): number {
  const pt = (cm / 2.54) * 72
  return Math.max(10, Math.ceil(pt / ROW_PT) + 1)
}



function dollarA1(col: number, row: number): string {
  let n = col + 1
  let letters = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return `$${letters}$${row}`
}

function dollarRange(c1: number, r1: number, c2: number, r2: number): string {
  return `${dollarA1(c1, r1)}:${dollarA1(c2, r2)}`
}

function signedColor(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null
  if (value > 0) return RED
  if (value < 0) return GREEN
  return "808080"
}

export type WeeklyReviewMarketChartOptions = {
  chart1Title?: string
  benchSeriesLabel?: string
  note?: string
}

export function buildWeeklyReviewMarketChartTables(
  benches: MarketBenchPoint[],
  poolRows: ChartFundRow[],
  sourceMedians: Array<{ bucket: string; values: Array<number | null> }>,
  tableLastExcelRow: number,
  options?: WeeklyReviewMarketChartOptions,
): WeeklyReviewMarketChartTables {
  const poolMedian = median(poolRows.map((row) => row.ret_1w))

  const chart1Cats: string[] = ["跟踪池中位数"]
  const chart1Pool: Array<number | null> = [poolMedian]
  const chart1Bench: Array<number | null> = [null]
  for (const bench of benches) {
    if (!bench.name) continue
    chart1Cats.push(bench.name)
    chart1Pool.push(null)
    chart1Bench.push(bench.ret != null && Number.isFinite(bench.ret) ? bench.ret : null)
  }

  const chart2Rows = sourceMedians.filter((row) => row.bucket && row.values.some((value) => value != null))

  const dataAoa: unknown[][] = []
  const set = (r: number, c: number, v: unknown) => {
    while (dataAoa.length <= r) dataAoa.push([])
    dataAoa[r][c] = v
  }

  set(0, 0, "名称")
  set(0, 1, "跟踪池")
  set(0, 2, options?.benchSeriesLabel ?? "宽基指数")
  chart1Cats.forEach((label, i) => {
    set(1 + i, 0, label)
    set(1 + i, 1, chart1Pool[i])
    set(1 + i, 2, chart1Bench[i])
  })
  const chart1Last = 1 + chart1Cats.length

  let chart2: BarChartSpec | null = null
  if (chart2Rows.length > 0) {
    const nameCol = 4
    set(0, nameCol, "策略")
    SOURCE_MEDIAN_SERIES.forEach((series, i) => set(0, nameCol + 1 + i, series.label))
    chart2Rows.forEach((row, i) => {
      set(1 + i, nameCol, row.bucket)
      row.values.forEach((value, c) => set(1 + i, nameCol + 1 + c, value))
    })
    const chart2Last = 1 + chart2Rows.length
    const bounds = valueAxisBounds(chart2Rows.flatMap((row) => row.values), true)
    chart2 = {
      title: "各策略来源近一周中位数",
      barDir: "bar",
      catRange: dollarRange(nameCol, 2, nameCol, chart2Last),
      valueMin: bounds.min,
      valueMax: bounds.max,
      series: SOURCE_MEDIAN_SERIES.map((series, i) => ({
        titleCell: dollarA1(nameCol + 1 + i, 1),
        valRange: dollarRange(nameCol + 1 + i, 2, nameCol + 1 + i, chart2Last),
        color: series.color,
        showVal: false,
      })),
    }
  }

  const chart1: BarChartSpec = {
    title: options?.chart1Title ?? "跟踪池 vs 宽基指数（近一周）",
    barDir: "col",
    catRange: dollarRange(0, 2, 0, chart1Last),
    series: [
      { titleCell: "B1", valRange: dollarRange(1, 2, 1, chart1Last), color: NAVY },
      {
        titleCell: "C1",
        valRange: dollarRange(2, 2, 2, chart1Last),
        color: RED,
        pointColors: chart1Bench.map((value) => signedColor(value)),
      },
    ],
  }

  const noteExcelRow = tableLastExcelRow + 2
  const chart1StartRow = noteExcelRow + 1
  const chart1HeightRows = heightRows(10)
  const chart2HeightCm = chart2
    ? Math.max(9, 2.6 + chart2Rows.length * 1.35)
    : 0
  const chart2HeightRows = chart2 ? heightRows(chart2HeightCm) : 0
  const chart2StartRow = chart2 ? chart1StartRow + chart1HeightRows : null
  const afterCharts = (chart2StartRow ?? chart1StartRow) + (chart2 ? chart2HeightRows : chart1HeightRows)
  const commentRow = afterCharts + 1

  return {
    dataAoa,
    dataSheetName: DATA_SHEET,
    note: options?.note ?? NOTE,
    chart1StartRow,
    chart2StartRow,
    chart1HeightRows,
    chart2HeightRows,
    commentRow,
    chart1,
    chart2,
  }
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formulaFor(sheetName: string, cellOrRange: string): string {
  const escaped = sheetName.replace(/'/g, "''")
  return `'${escaped}'!${cellOrRange}`
}

function seriesXml(
  index: number,
  sheetName: string,
  spec: BarChartSpec["series"][number],
  catRange: string,
  labelPos: "outEnd" | "inEnd" = "outEnd",
): string {
  const invert = spec.invertIfNegative
    ? "<c:invertIfNegative val=\"1\"/>"
    : "<c:invertIfNegative val=\"0\"/>"
  const showVal = spec.showVal === false ? "0" : "1"
  const points = (spec.pointColors ?? [])
    .map((color, i) => {
      if (!color) return ""
      return `<c:dPt>
  <c:idx val="${i}"/>
  <c:invertIfNegative val="0"/>
  <c:spPr>
    <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </c:spPr>
</c:dPt>`
    })
    .join("")
  return `<c:ser>
  <c:idx val="${index}"/>
  <c:order val="${index}"/>
  <c:tx><c:strRef><c:f>${xmlEscape(formulaFor(sheetName, spec.titleCell))}</c:f></c:strRef></c:tx>
  <c:spPr>
    <a:solidFill><a:srgbClr val="${spec.color}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </c:spPr>
  ${invert}
  ${points}
  <c:dLbls>
    <c:numFmt formatCode="0.00%" sourceLinked="0"/>
    <c:dLblPos val="${labelPos}"/>
    <c:showVal val="${showVal}"/>
    <c:showCatName val="0"/>
    <c:showSerName val="0"/>
    <c:showPercent val="0"/>
  </c:dLbls>
  <c:cat><c:strRef><c:f>${xmlEscape(formulaFor(sheetName, catRange))}</c:f></c:strRef></c:cat>
  <c:val><c:numRef><c:f>${xmlEscape(formulaFor(sheetName, spec.valRange))}</c:f></c:numRef></c:val>
</c:ser>`
}

function chartXml(sheetName: string, spec: BarChartSpec): string {
  const catAxId = 200
  const valAxId = 100
  const catPos = spec.barDir === "bar" ? "l" : "b"
  const valPos = spec.barDir === "bar" ? "b" : "l"
  const rotate = spec.barDir === "col"
    ? `<c:txPr><a:bodyPr rot="-2700000" wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr sz="800"/></a:p></c:txPr>`
    : `<c:txPr><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="700"/></a:pPr><a:endParaRPr sz="700"/></a:p></c:txPr>`
  const series = spec.series.map((item, i) => seriesXml(i, sheetName, item, spec.catRange, spec.barDir === "bar" ? "inEnd" : "outEnd")).join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx><c:rich>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr><a:defRPr sz="1200" b="1"><a:latin typeface="宋体"/><a:ea typeface="宋体"/></a:defRPr></a:pPr>
          <a:r><a:rPr sz="1200" b="1"><a:latin typeface="宋体"/><a:ea typeface="宋体"/></a:rPr><a:t>${xmlEscape(spec.title)}</a:t></a:r>
        </a:p>
      </c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout>${spec.barDir === "bar" ? `<c:manualLayout>
        <c:layoutTarget val="inner"/>
        <c:xMode val="edge"/>
        <c:yMode val="edge"/>
        <c:x val="0.40"/>
        <c:y val="0.08"/>
        <c:w val="0.56"/>
        <c:h val="0.80"/>
      </c:manualLayout>` : ""}</c:layout>
      <c:barChart>
        <c:barDir val="${spec.barDir}"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${series}
        <c:dLbls>
          <c:showVal val="0"/>
        </c:dLbls>
        <c:gapWidth val="80"/>
        <c:overlap val="0"/>
        <c:axId val="${catAxId}"/>
        <c:axId val="${valAxId}"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="${catAxId}"/>
        <c:scaling><c:orientation val="${spec.barDir === "bar" ? "maxMin" : "minMax"}"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${catPos}"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="low"/>
        <c:crossAx val="${valAxId}"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        ${rotate}
      </c:catAx>
      <c:valAx>
        <c:axId val="${valAxId}"/>
        <c:scaling>
          <c:orientation val="minMax"/>
          ${spec.valueMin != null ? `<c:min val="${spec.valueMin}"/>` : ""}
          ${spec.valueMax != null ? `<c:max val="${spec.valueMax}"/>` : ""}
        </c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${valPos}"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="0.0%" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="${catAxId}"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
    <c:showDLblsOverMax val="0"/>
  </c:chart>
</c:chartSpace>`
}

function drawingXml(charts: Array<{ relId: string; name: string; startRow: number; heightRows: number }>): string {
  const anchors = charts.map((chart, i) => {
    const cy = Math.round((chart.heightRows * ROW_PT / 72) * 914400)
    const cx = CHART_WIDTH_CM * CM_TO_EMU
    return `<xdr:oneCellAnchor>
  <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.startRow - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:ext cx="${cx}" cy="${cy}"/>
  <xdr:graphicFrame macro="">
    <xdr:nvGraphicFramePr>
      <xdr:cNvPr id="${i + 2}" name="${xmlEscape(chart.name)}"/>
      <xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr>
    </xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chart.relId}"/>
      </a:graphicData>
    </a:graphic>
  </xdr:graphicFrame>
  <xdr:clientData/>
</xdr:oneCellAnchor>`
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${anchors.join("\n")}
</xdr:wsDr>`
}

function attr(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`${name}="([^"]+)"`))
  return match?.[1] ?? null
}

function sheetPathFromWorkbook(workbookXml: string, relsXml: string, sheetName: string): string | null {
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const sheet = workbookXml.match(new RegExp(`<sheet[^>]*name="${escaped}"[^>]*/>`))
    ?? workbookXml.match(new RegExp(`<sheet[^>]*name="${escaped}"[^>]*>`))
  if (!sheet) return null
  const rid = attr(sheet[0], "r:id")
  if (!rid) return null
  const rel = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*/>`))
    ?? relsXml.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))
  if (!rel) return null
  let target = attr(rel[0], "Target")
  if (!target) return null
  target = target.replace(/^\/xl\//, "").replace(/^\//, "")
  if (target.startsWith("xl/")) return target
  if (target.startsWith("worksheets/")) return `xl/${target}`
  return `xl/${target}`
}

function nextPartNumber(paths: string[], prefix: string, suffix: string): number {
  let max = 0
  for (const path of paths) {
    const base = path.split("/").pop() ?? ""
    if (!base.startsWith(prefix) || !base.endsWith(suffix)) continue
    const n = Number(base.slice(prefix.length, base.length - suffix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

function hideSheet(workbookXml: string, sheetName: string): string {
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return workbookXml.replace(
    new RegExp(`<sheet([^>]*name="${escaped}"[^>]*)/>`),
    (full, inner: string) => {
      if (/\sstate=/.test(inner)) {
        return full.replace(/\sstate="[^"]*"/, ' state="hidden"')
      }
      return `<sheet${inner} state="hidden"/>`
    },
  )
}

function ensureOverride(contentTypes: string, partName: string, contentType: string): string {
  if (contentTypes.includes(`PartName="${partName}"`)) return contentTypes
  const tag = `<Override PartName="${partName}" ContentType="${contentType}"/>`
  if (contentTypes.includes("</Types>")) return contentTypes.replace("</Types>", `${tag}</Types>`)
  return `${contentTypes}${tag}`
}

function insertDrawing(sheetXml: string, rid: string): string {
  if (/<drawing[\s>]/.test(sheetXml)) return sheetXml
  const tag = `<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/>`
  if (sheetXml.includes("</worksheet>")) {
    return sheetXml.replace("</worksheet>", `${tag}</worksheet>`)
  }
  return `${sheetXml}${tag}`
}

function relsFile(pairs: Array<{ id: string; type: string; target: string }>): string {
  const body = pairs
    .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`)
    .join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

type ZipAdapter = {
  paths: () => string[]
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => void
  toBuffer: () => Promise<Buffer>
}

async function openZip(buffer: Buffer): Promise<ZipAdapter> {
  try {
    const zipMod = await import("jszip") as { default?: { loadAsync: (data: Buffer) => Promise<any> }; loadAsync?: (data: Buffer) => Promise<any> }
    const JSZip = zipMod.default ?? zipMod
    const zip = await (JSZip as { loadAsync: (data: Buffer) => Promise<any> }).loadAsync(buffer)
    return {
      paths: () => Object.keys(zip.files),
      read: async (path) => {
        const file = zip.file(path)
        if (!file) return null
        return file.async("string") as Promise<string>
      },
      write: (path, text) => {
        zip.file(path, text)
      },
      toBuffer: async () => Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })),
    }
  } catch {
    const fflate = await import("fflate") as {
      unzipSync: (data: Uint8Array) => Record<string, Uint8Array>
      zipSync: (data: Record<string, Uint8Array>) => Uint8Array
      strToU8: (s: string) => Uint8Array
      strFromU8: (u: Uint8Array) => string
    }
    const files = fflate.unzipSync(new Uint8Array(buffer))
    return {
      paths: () => Object.keys(files),
      read: async (path) => (files[path] ? fflate.strFromU8(files[path]) : null),
      write: (path, text) => {
        files[path] = fflate.strToU8(text)
      },
      toBuffer: async () => Buffer.from(fflate.zipSync(files)),
    }
  }
}

function headerFreezePane(splitRows: number): string {
  const next = splitRows + 1
  return `<pane ySplit="${splitRows}" topLeftCell="A${next}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="A${next}" sqref="A${next}"/>`
}

/** Keep the header rows on screen. xlsx-js-style does not write freeze panes. */
export async function freezeWorksheetHeaderRows(buffer: Buffer, sheetNames: string[], splitRows = 1): Promise<Buffer> {
  const names = [...new Set(sheetNames.filter(Boolean))]
  if (names.length === 0) return buffer
  const zip = await openZip(buffer)
  const workbookXml = await zip.read("xl/workbook.xml")
  const relsXml = await zip.read("xl/_rels/workbook.xml.rels")
  if (!workbookXml || !relsXml) return buffer
  for (const name of names) {
    const path = sheetPathFromWorkbook(workbookXml, relsXml, name)
    if (!path) continue
    const xml = await zip.read(path)
    if (!xml || xml.includes('state="frozen"')) continue
    const frozen = xml.replace(
      /<sheetViews>\s*<sheetView([^>]*?)\/>\s*<\/sheetViews>/,
      `<sheetViews><sheetView$1>${headerFreezePane(splitRows)}</sheetView></sheetViews>`,
    )
    if (frozen !== xml) zip.write(path, frozen)
  }
  return zip.toBuffer()
}

export async function embedWeeklyReviewMarketCharts(
  buffer: Buffer,
  tables: WeeklyReviewMarketChartTables,
  marketSheetName: string,
): Promise<Buffer> {
  const zip = await openZip(buffer)
  const workbookXml = await zip.read("xl/workbook.xml")
  const relsXml = await zip.read("xl/_rels/workbook.xml.rels")
  const contentTypes = await zip.read("[Content_Types].xml")
  if (!workbookXml || !relsXml || !contentTypes) return buffer

  const marketPath = sheetPathFromWorkbook(workbookXml, relsXml, marketSheetName)
  if (!marketPath) return buffer
  const sheetXml = await zip.read(marketPath)
  if (!sheetXml) return buffer

  const hiddenWorkbook = hideSheet(workbookXml, tables.dataSheetName)
  zip.write("xl/workbook.xml", hiddenWorkbook)

  const paths = zip.paths()
  const drawingN = nextPartNumber(paths, "drawing", ".xml")
  const chartN = nextPartNumber(paths, "chart", ".xml")
  const drawingPath = `xl/drawings/drawing${drawingN}.xml`
  const chart1Path = `xl/charts/chart${chartN}.xml`
  const chart2Path = tables.chart2 ? `xl/charts/chart${chartN + 1}.xml` : null

  zip.write(chart1Path, chartXml(tables.dataSheetName, tables.chart1))
  if (tables.chart2 && chart2Path) {
    zip.write(chart2Path, chartXml(tables.dataSheetName, tables.chart2))
  }

  const drawingCharts = [
    {
      relId: "rId1",
      name: "跟踪池对比宽基",
      startRow: tables.chart1StartRow,
      heightRows: tables.chart1HeightRows,
    },
  ]
  if (tables.chart2) {
    drawingCharts.push({
      relId: "rId2",
      name: "各策略来源中位数",
      startRow: tables.chart2StartRow ?? tables.chart1StartRow + tables.chart1HeightRows,
      heightRows: tables.chart2HeightRows,
    })
  }
  zip.write(drawingPath, drawingXml(drawingCharts))
  zip.write(
    `xl/drawings/_rels/drawing${drawingN}.xml.rels`,
    relsFile([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
        target: `../charts/chart${chartN}.xml`,
      },
      ...(chart2Path
        ? [{
            id: "rId2",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
            target: `../charts/chart${chartN + 1}.xml`,
          }]
        : []),
    ]),
  )

  const sheetFile = marketPath.split("/").pop() ?? "sheet3.xml"
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`
  const existingRels = await zip.read(sheetRelsPath)
  const nextRid = (() => {
    if (!existingRels) return 1
    const ids = [...existingRels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))
    return (ids.length ? Math.max(...ids) : 0) + 1
  })()
  const drawingRid = `rId${nextRid}`
  const drawingRel = {
    id: drawingRid,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
    target: `../drawings/drawing${drawingN}.xml`,
  }
  if (existingRels && existingRels.includes("</Relationships>")) {
    zip.write(
      sheetRelsPath,
      existingRels.replace(
        "</Relationships>",
        `<Relationship Id="${drawingRel.id}" Type="${drawingRel.type}" Target="${drawingRel.target}"/></Relationships>`,
      ),
    )
  } else {
    zip.write(sheetRelsPath, relsFile([drawingRel]))
  }
  zip.write(marketPath, insertDrawing(sheetXml, drawingRid))

  let types = contentTypes
  types = ensureOverride(types, `/${drawingPath}`, "application/vnd.openxmlformats-officedocument.drawing+xml")
  types = ensureOverride(types, `/${chart1Path}`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")
  if (chart2Path) {
    types = ensureOverride(types, `/${chart2Path}`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")
  }
  zip.write("[Content_Types].xml", types)

  return zip.toBuffer()
}
