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
  "近一周均为绝对收益，与上方指数涨跌幅同一口径。已投产品对比同策略跟踪池中位数。"
const NAVY = "1F4E79"
const GOLD = "C59A00"
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

function truncateLabel(name: string, max = 18): string {
  const text = name.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}


function signedColor(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null
  if (value > 0) return RED
  if (value < 0) return GREEN
  return "808080"
}

function uniqueInvested(rows: ChartFundRow[]): ChartFundRow[] {
  const seen = new Set<string>()
  const out: ChartFundRow[] = []
  for (const row of rows) {
    const key = row.beian_hao.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

export function buildWeeklyReviewMarketChartTables(
  benches: MarketBenchPoint[],
  poolRows: ChartFundRow[],
  investedRows: ChartFundRow[],
  tableLastExcelRow: number,
): WeeklyReviewMarketChartTables {
  const poolMedian = median(poolRows.map((row) => row.ret_1w))
  const byBucket = new Map<string, number[]>()
  for (const row of poolRows) {
    if (row.ret_1w == null || !Number.isFinite(row.ret_1w)) continue
    const list = byBucket.get(row.bucket) ?? []
    list.push(row.ret_1w)
    byBucket.set(row.bucket, list)
  }

  const chart1Cats: string[] = ["跟踪池中位数"]
  const chart1Pool: Array<number | null> = [poolMedian]
  const chart1Bench: Array<number | null> = [null]
  for (const bench of benches) {
    if (!bench.name) continue
    chart1Cats.push(bench.name)
    chart1Pool.push(null)
    chart1Bench.push(bench.ret != null && Number.isFinite(bench.ret) ? bench.ret : null)
  }

  const invested = uniqueInvested(investedRows)
  const investedMedian = median(invested.map((row) => row.ret_1w))
  const chart2Rows: Array<{ label: string; pool: number | null; invested: number | null }> = []
  if (invested.length > 0) {
    chart2Rows.push({ label: "整体", pool: poolMedian, invested: investedMedian })
    const sorted = [...invested].sort((a, b) => (b.ret_1w ?? -Infinity) - (a.ret_1w ?? -Infinity))
    for (const row of sorted) {
      const bucketMedian = median(byBucket.get(row.bucket) ?? [])
      const suffix = row.bucket ? `（${row.bucket}）` : ""
      chart2Rows.push({
        label: `${truncateLabel(row.name, 10)}${suffix}`,
        pool: bucketMedian,
        invested: row.ret_1w != null && Number.isFinite(row.ret_1w) ? row.ret_1w : null,
      })
    }
  }

  const dataAoa: unknown[][] = []
  const set = (r: number, c: number, v: unknown) => {
    while (dataAoa.length <= r) dataAoa.push([])
    dataAoa[r][c] = v
  }

  set(0, 0, "名称")
  set(0, 1, "跟踪池")
  set(0, 2, "宽基指数")
  chart1Cats.forEach((label, i) => {
    set(1 + i, 0, label)
    set(1 + i, 1, chart1Pool[i])
    set(1 + i, 2, chart1Bench[i])
  })
  const chart1Last = 1 + chart1Cats.length

  let chart2: BarChartSpec | null = null
  if (chart2Rows.length > 0) {
    set(0, 4, "名称")
    set(0, 5, "同策略跟踪池中位数")
    set(0, 6, "已投")
    chart2Rows.forEach((row, i) => {
      set(1 + i, 4, row.label)
      set(1 + i, 5, row.pool)
      set(1 + i, 6, row.invested)
    })
    const chart2Last = 1 + chart2Rows.length
    const many = chart2Rows.length > 8
    const bounds = valueAxisBounds(chart2Rows.flatMap((row) => [row.pool, row.invested]), many)
    chart2 = {
      title: "已投产品 vs 跟踪池（近一周）",
      barDir: many ? "bar" : "col",
      catRange: dollarRange(4, 2, 4, chart2Last),
      valueMin: bounds.min,
      valueMax: bounds.max,
      series: [
        { titleCell: "F1", valRange: dollarRange(5, 2, 5, chart2Last), color: NAVY, showVal: false },
        { titleCell: "G1", valRange: dollarRange(6, 2, 6, chart2Last), color: GOLD, showVal: true },
      ],
    }
  }

  const chart1: BarChartSpec = {
    title: "跟踪池 vs 宽基指数（近一周）",
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
    ? Math.max(8, 3.2 + chart2Rows.length * (chart2.barDir === "bar" ? 0.88 : 0.45))
    : 0
  const chart2HeightRows = chart2 ? heightRows(chart2HeightCm) : 0
  const chart2StartRow = chart2 ? chart1StartRow + chart1HeightRows : null
  const afterCharts = (chart2StartRow ?? chart1StartRow) + (chart2 ? chart2HeightRows : chart1HeightRows)
  const commentRow = afterCharts + 1

  return {
    dataAoa,
    dataSheetName: DATA_SHEET,
    note: NOTE,
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
      name: "已投对比跟踪池",
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
