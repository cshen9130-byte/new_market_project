export type TemplateInputType =
  | "product"
  | "products"
  | "date"
  | "date_range"
  | "text"
  | "select"
  | "number"
  | "benchmark"

export type TemplateElementType =
  | "title"
  | "subtitle"
  | "text"
  | "rich-text"
  | "nav-chart"
  | "return-chart"
  | "drawdown-chart"
  | "rolling-vol-chart"
  | "bar-chart"
  | "pie-chart"
  | "scatter-chart"
  | "heatmap"
  | "table"
  | "metric-card"
  | "metric-grid"
  | "kpi-row"
  | "product-info"
  | "benchmark-compare"
  | "date-display"
  | "image"
  | "logo"
  | "divider"
  | "spacer"
  | "page-break"
  | "pf-product-elements"
  | "pf-product-performance"
  | "pf-performance-indicators"
  | "pf-interval-metrics"
  | "pf-monthly-returns"
  | "pf-annual-metrics"
  | "pf-period-stats"
  | "pf-dynamic-drawdown"
  | "pf-drawdown-episodes"
  | "pf-win-rate"
  | "pf-fund-profile"
  | "pf-fund-rating"
  | "pf-scenario-analysis"
  | "pf-nav-attribution"
  | "pf-fund-company"
  | "pf-materials"
  | "pf-holdings-analysis"
  | "pf-return-analysis"

export type TemplateInputField = {
  id: string
  label: string
  type: TemplateInputType
  placeholder?: string
  options?: string[]
  required?: boolean
}

export type TableColumnSource = "static" | "product_field" | "metric" | "input"

export type TableColumnDef = {
  id: string
  header: string
  source: TableColumnSource
  staticValue?: string
  productField?: string
  metricKey?: string
  bindInputId?: string
  period?: string
  format?: "text" | "percent" | "number" | "date" | "currency" | "integer"
  align?: "left" | "center" | "right"
  widthWeight?: number
}

export type ElementStyle = {
  backgroundColor?: string
  backgroundOpacity?: number
  textColor?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  borderStyle?: "none" | "solid" | "dashed" | "dotted"
  shadowEnabled?: boolean
  shadowBlur?: number
  shadowSpread?: number
  shadowOpacity?: number
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  padding?: number
  opacity?: number
  fontWeight?: number | "normal" | "bold"
  fontFamily?: string
  lineHeight?: number
  letterSpacing?: number
}

export type TemplateElementProps = {
  text?: string
  fontSize?: number
  align?: "left" | "center" | "right"
  bindInputId?: string
  bindProductInputId?: string
  tableColumns?: TableColumnDef[]
  tableRowSource?: "single_product" | "product_list"
  tablePeriod?: string
  tableStriped?: boolean
  tableHeaderBg?: string
  tableBorderStyle?: "none" | "solid" | "horizontal"
  tableFontSize?: number
  tableShowIndex?: boolean
  tableCompact?: boolean
  chartPeriod?: string
  showLegend?: boolean
  showGrid?: boolean
  showDataLabels?: boolean
  chartColor?: string
  chartColors?: string[]
  benchmarkInputId?: string
  metricKey?: string
  metricLabel?: string
  metricPeriod?: string
  imageUrl?: string
  objectFit?: "cover" | "contain" | "fill"
  dividerStyle?: "solid" | "dashed" | "dotted"
  dividerThickness?: number
  /** 私募基金模块：包含的子区块 */
  moduleSections?: string[]
  style?: ElementStyle
  stylePreset?: string
}

export type TemplateElement = {
  id: string
  type: TemplateElementType
  x: number
  y: number
  width: number
  height: number
  props: TemplateElementProps
}

export type CanvasSettings = {
  widthPx: number
  heightPx: number
  preset?: string
  backgroundColor?: string
  backgroundOpacity?: number
  padding?: number
  showGrid?: boolean
  gridSize?: number
  pageStylePreset?: string
}

export type ReportCustomTemplate = {
  id: string
  name: string
  description?: string
  inputs: TemplateInputField[]
  elements: TemplateElement[]
  canvas: CanvasSettings
  /** @deprecated use canvas */
  canvasAspect?: "16:9" | "a4"
  updatedAt: string
}

export const REPORT_TEMPLATES_STORAGE_KEY = "report_custom_templates_v3"
const DEMO_SEED_DATE = "2026-07-06T00:00:00.000Z"

export const TOOLBOX_GROUPS: {
  label: string
  items: TemplateElementType[]
}[] = [
  {
    label: "文本",
    items: ["title", "subtitle", "text", "rich-text", "date-display"],
  },
  {
    label: "图表",
    items: ["nav-chart", "return-chart", "drawdown-chart", "rolling-vol-chart", "bar-chart", "pie-chart", "scatter-chart", "heatmap"],
  },
  {
    label: "数据",
    items: ["table", "metric-card", "metric-grid", "kpi-row", "product-info", "benchmark-compare"],
  },
  {
    label: "媒体与布局",
    items: ["image", "logo", "divider", "spacer", "page-break"],
  },
  {
    label: "私募基金模块",
    items: [
      "pf-product-elements",
      "pf-product-performance",
      "pf-performance-indicators",
      "pf-period-stats",
      "pf-interval-metrics",
      "pf-monthly-returns",
      "pf-annual-metrics",
      "pf-dynamic-drawdown",
      "pf-drawdown-episodes",
      "pf-win-rate",
      "pf-fund-profile",
      "pf-fund-rating",
      "pf-scenario-analysis",
      "pf-nav-attribution",
      "pf-fund-company",
      "pf-holdings-analysis",
      "pf-return-analysis",
      "pf-materials",
    ],
  },
]

export const ELEMENT_TYPE_META: Record<
  TemplateElementType,
  { label: string; defaultW: number; defaultH: number; defaultProps: TemplateElementProps }
> = {
  title: { label: "标题", defaultW: 60, defaultH: 8, defaultProps: { text: "报告标题", fontSize: 28, align: "center", stylePreset: "default" } },
  subtitle: { label: "副标题", defaultW: 50, defaultH: 6, defaultProps: { text: "副标题说明", fontSize: 16, align: "center" } },
  text: { label: "文本框", defaultW: 40, defaultH: 12, defaultProps: { text: "在此输入文本内容", fontSize: 14, align: "left" } },
  "rich-text": { label: "富文本", defaultW: 45, defaultH: 18, defaultProps: { text: "支持多段落的富文本内容区域", fontSize: 13, align: "left", stylePreset: "card-soft" } },
  "nav-chart": { label: "净值曲线", defaultW: 45, defaultH: 28, defaultProps: { chartPeriod: "近一年", showLegend: true, showGrid: true, chartColor: "#ef4444", stylePreset: "card-soft" } },
  "return-chart": { label: "收益曲线", defaultW: 45, defaultH: 26, defaultProps: { chartPeriod: "近一年", showLegend: true, chartColor: "#3b82f6", stylePreset: "card-soft" } },
  "drawdown-chart": { label: "回撤曲线", defaultW: 45, defaultH: 22, defaultProps: { chartPeriod: "近一年", showGrid: true, chartColor: "#f97316", stylePreset: "card-soft" } },
  "rolling-vol-chart": { label: "滚动波动率", defaultW: 45, defaultH: 22, defaultProps: { chartPeriod: "近一年", showGrid: true, chartColor: "#8b5cf6", stylePreset: "card-soft" } },
  "bar-chart": { label: "柱状图", defaultW: 40, defaultH: 24, defaultProps: { chartPeriod: "近一年", showDataLabels: true, stylePreset: "card-soft" } },
  "pie-chart": { label: "饼图", defaultW: 30, defaultH: 28, defaultProps: { showLegend: true, stylePreset: "card-soft" } },
  "scatter-chart": { label: "散点图", defaultW: 40, defaultH: 28, defaultProps: { chartPeriod: "近一年", showGrid: true, stylePreset: "card-soft" } },
  heatmap: { label: "热力图", defaultW: 45, defaultH: 26, defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" } },
  table: {
    label: "数据表格",
    defaultW: 75,
    defaultH: 32,
    defaultProps: {
      tableRowSource: "single_product",
      tablePeriod: "近一年",
      tableStriped: true,
      tableHeaderBg: "#fafafa",
      tableBorderStyle: "solid",
      tableFontSize: 11,
      tableShowIndex: false,
      tableCompact: false,
      stylePreset: "default",
      tableColumns: [
        { id: "col_name", header: "产品名称", source: "product_field", productField: "product_name", align: "left", format: "text", widthWeight: 2 },
        { id: "col_ret", header: "近一年收益", source: "metric", metricKey: "ret_1y", format: "percent", align: "right", period: "近一年" },
        { id: "col_dd", header: "最大回撤", source: "metric", metricKey: "max_dd_1y", format: "percent", align: "right", period: "近一年" },
        { id: "col_sharpe", header: "夏普比率", source: "metric", metricKey: "sharpe_1y", format: "number", align: "right", period: "近一年" },
        { id: "col_calmar", header: "卡玛比率", source: "metric", metricKey: "calmar_1y", format: "number", align: "right", period: "近一年" },
      ],
    },
  },
  "metric-card": { label: "指标卡片", defaultW: 22, defaultH: 14, defaultProps: { metricKey: "calmar_1y", metricLabel: "卡玛比率", metricPeriod: "近一年", stylePreset: "highlight-red" } },
  "metric-grid": { label: "指标网格", defaultW: 60, defaultH: 20, defaultProps: { metricPeriod: "近一年", stylePreset: "card-soft" } },
  "kpi-row": { label: "KPI 行", defaultW: 80, defaultH: 12, defaultProps: { metricPeriod: "近一年", stylePreset: "glass" } },
  "product-info": { label: "产品信息", defaultW: 40, defaultH: 22, defaultProps: { stylePreset: "card-soft" } },
  "benchmark-compare": { label: "基准对比", defaultW: 50, defaultH: 28, defaultProps: { chartPeriod: "近一年", showLegend: true, stylePreset: "card-soft" } },
  "date-display": { label: "日期显示", defaultW: 25, defaultH: 6, defaultProps: { text: "报告日期：{日期}", fontSize: 12, align: "right" } },
  image: { label: "图片", defaultW: 30, defaultH: 20, defaultProps: { objectFit: "cover", stylePreset: "minimal-border" } },
  logo: { label: "Logo", defaultW: 15, defaultH: 10, defaultProps: { objectFit: "contain" } },
  divider: { label: "分隔线", defaultW: 80, defaultH: 2, defaultProps: { dividerStyle: "solid", dividerThickness: 1 } },
  spacer: { label: "间距", defaultW: 80, defaultH: 4, defaultProps: {} },
  "page-break": { label: "分页符", defaultW: 80, defaultH: 3, defaultProps: { dividerStyle: "dashed", dividerThickness: 2 } },
  "pf-product-elements": {
    label: "产品要素",
    defaultW: 80,
    defaultH: 36,
    defaultProps: {
      moduleSections: ["基本信息", "申赎信息"],
      stylePreset: "card-soft",
    },
  },
  "pf-product-performance": {
    label: "产品表现",
    defaultW: 80,
    defaultH: 40,
    defaultProps: {
      chartPeriod: "近一年",
      showLegend: true,
      moduleSections: ["净值曲线", "累计收益", "区间统计"],
      stylePreset: "card-soft",
    },
  },
  "pf-performance-indicators": {
    label: "业绩指标",
    defaultW: 85,
    defaultH: 45,
    defaultProps: {
      chartPeriod: "近一年",
      showLegend: true,
      showGrid: true,
      moduleSections: ["净值曲线", "区间统计", "动态回撤"],
      stylePreset: "card-soft",
    },
  },
  "pf-period-stats": {
    label: "区间统计表",
    defaultW: 70,
    defaultH: 28,
    defaultProps: { chartPeriod: "近一年", tableStriped: true, stylePreset: "default" },
  },
  "pf-interval-metrics": {
    label: "区间指标表",
    defaultW: 75,
    defaultH: 30,
    defaultProps: { chartPeriod: "近一年", tableStriped: true, stylePreset: "default" },
  },
  "pf-monthly-returns": {
    label: "月度收益日历",
    defaultW: 70,
    defaultH: 32,
    defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" },
  },
  "pf-annual-metrics": {
    label: "年度指标表",
    defaultW: 70,
    defaultH: 28,
    defaultProps: { stylePreset: "default" },
  },
  "pf-dynamic-drawdown": {
    label: "动态回撤",
    defaultW: 55,
    defaultH: 26,
    defaultProps: { chartPeriod: "近一年", chartColor: "#f97316", stylePreset: "card-soft" },
  },
  "pf-drawdown-episodes": {
    label: "回撤区间表",
    defaultW: 65,
    defaultH: 24,
    defaultProps: { chartPeriod: "近一年", tableStriped: true, stylePreset: "default" },
  },
  "pf-win-rate": {
    label: "胜率分析",
    defaultW: 55,
    defaultH: 26,
    defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" },
  },
  "pf-fund-profile": {
    label: "基金档案",
    defaultW: 60,
    defaultH: 30,
    defaultProps: { moduleSections: ["策略说明", "投资范围", "风控措施"], stylePreset: "card-soft" },
  },
  "pf-fund-rating": {
    label: "基金评分",
    defaultW: 45,
    defaultH: 28,
    defaultProps: { stylePreset: "highlight-red" },
  },
  "pf-scenario-analysis": {
    label: "情景分析",
    defaultW: 60,
    defaultH: 30,
    defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" },
  },
  "pf-nav-attribution": {
    label: "净值归因",
    defaultW: 65,
    defaultH: 30,
    defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" },
  },
  "pf-fund-company": {
    label: "基金公司",
    defaultW: 55,
    defaultH: 28,
    defaultProps: { moduleSections: ["公司简介", "管理规模", "团队"], stylePreset: "card-soft" },
  },
  "pf-holdings-analysis": {
    label: "持仓分析",
    defaultW: 70,
    defaultH: 32,
    defaultProps: { stylePreset: "card-soft" },
  },
  "pf-return-analysis": {
    label: "收益分析",
    defaultW: 65,
    defaultH: 30,
    defaultProps: { chartPeriod: "近一年", stylePreset: "card-soft" },
  },
  "pf-materials": {
    label: "相关资料",
    defaultW: 50,
    defaultH: 22,
    defaultProps: { stylePreset: "default" },
  },
}

export const INPUT_TYPE_META: Record<TemplateInputType, { label: string }> = {
  product: { label: "产品选择（单个）" },
  products: { label: "产品选择（多个）" },
  date: { label: "日期" },
  date_range: { label: "日期范围" },
  text: { label: "文本输入" },
  select: { label: "下拉选择" },
  number: { label: "数字输入" },
  benchmark: { label: "基准选择" },
}

export function createElementId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createInputId(): string {
  return `inp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createTemplateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createColumnId(): string {
  return `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export const PF_MODULE_TYPES: TemplateElementType[] = [
  "pf-product-elements",
  "pf-product-performance",
  "pf-performance-indicators",
  "pf-interval-metrics",
  "pf-monthly-returns",
  "pf-annual-metrics",
  "pf-period-stats",
  "pf-dynamic-drawdown",
  "pf-drawdown-episodes",
  "pf-win-rate",
  "pf-fund-profile",
  "pf-fund-rating",
  "pf-scenario-analysis",
  "pf-nav-attribution",
  "pf-fund-company",
  "pf-materials",
  "pf-holdings-analysis",
  "pf-return-analysis",
]

export function isPfModuleType(type: TemplateElementType): boolean {
  return PF_MODULE_TYPES.includes(type)
}

export const PF_MODULE_SECTION_OPTIONS: Record<string, string[]> = {
  "pf-product-elements": ["基本信息", "申赎信息", "费率结构"],
  "pf-product-performance": ["净值曲线", "累计收益", "区间统计", "基准对比"],
  "pf-performance-indicators": ["净值曲线", "区间统计", "动态回撤", "回撤区间"],
  "pf-fund-profile": ["策略说明", "投资范围", "风控措施", "业绩报酬"],
  "pf-fund-company": ["公司简介", "管理规模", "团队", "投资理念"],
}

export function defaultCanvas(): CanvasSettings {
  return {
    widthPx: 1280,
    heightPx: 720,
    preset: "16:9",
    backgroundColor: "#ffffff",
    backgroundOpacity: 100,
    padding: 24,
    showGrid: true,
    gridSize: 20,
    pageStylePreset: "page-white",
  }
}

export function normalizeTemplate(raw: ReportCustomTemplate): ReportCustomTemplate {
  const canvas = raw.canvas ?? defaultCanvas()
  if (!raw.canvas && raw.canvasAspect) {
    if (raw.canvasAspect === "a4") {
      canvas.widthPx = 794
      canvas.heightPx = 1123
      canvas.preset = "a4"
    } else {
      canvas.widthPx = 1280
      canvas.heightPx = 720
      canvas.preset = "16:9"
    }
  }

  const elements = raw.elements.map((el) => {
    const props = { ...el.props }
    if (el.type === "table" && props.tableColumns) {
      props.tableColumns = (props.tableColumns as unknown[]).map((col) => {
        if (typeof col === "string") {
          return { id: createColumnId(), header: col, source: "static" as const, staticValue: "—", align: "left" as const, format: "text" as const }
        }
        return col
      })
    }
    return { ...el, props }
  })

  return { ...raw, canvas, elements }
}

// ─── Built-in demo template ──────────────────────────────────────────────────
// Displayed automatically when the user has no saved templates yet.
// Uses fixed IDs so it can be safely seeded once.
export const DEMO_TEMPLATE_ID = "tpl_demo_builtin_001"

export function buildDemoTemplate(): ReportCustomTemplate {
  const pId     = "inp_demo_product"
  const benchId = "inp_demo_bench"
  const dateId  = "inp_demo_date"

  // ── Shared style helpers ────────────────────────────────────────────────
  const card: ElementStyle = {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    shadowEnabled: true,
    shadowBlur: 20,
    shadowSpread: 0,
    shadowOpacity: 6,
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowColor: "#1a2744",
    padding: 20,
  }

  // Section header: thin red left-accent bar element (0.45% wide)
  function sectionBar(y: number, h: number, id: string): TemplateElement {
    return {
      id,
      type: "spacer",
      x: 2.5, y, width: 0.45, height: h,
      props: { style: { backgroundColor: "#c0392b", backgroundOpacity: 100, borderRadius: 2 } },
    }
  }

  function sectionLabel(y: number, h: number, id: string, text: string): TemplateElement {
    return {
      id,
      type: "subtitle",
      x: 3.5, y, width: 93.5, height: h,
      props: {
        text,
        fontSize: 15,
        align: "left",
        style: { textColor: "#1a2744", fontWeight: "bold", padding: 0 },
      },
    }
  }

  // ── Layout grid (1280 × 2000 px canvas, percentages) ────────────────────
  // Row 0-12%   : dark-navy header
  // Row 12-12.6%: red accent strip
  // Row 13-25%  : 4 KPI metric-cards
  // Row 26-38%  : 产品要素
  // Row 39-63%  : NAV chart (left 57%) + performance panel (right 38%)
  // Row 64-80%  : 区间统计表
  // Row 81-93%  : 月度收益日历
  // Row 94-98%  : 动态回撤
  // Row 99%     : 免责声明

  return {
    id: DEMO_TEMPLATE_ID,
    name: "私募基金季度报告（示例）",
    description: "专业版季报模板：深蓝封面 · 4项核心指标卡 · 产品要素 · 净值走势 · 区间统计表 · 月度收益日历 · 动态回撤。可直接编辑或复制后修改。",
    canvas: {
      widthPx: 1280,
      heightPx: 2000,
      preset: "custom",
      backgroundColor: "#eef0f5",
      backgroundOpacity: 100,
      padding: 0,
      showGrid: false,
      gridSize: 20,
      pageStylePreset: "page-white",
    },
    inputs: [
      { id: pId,     label: "目标产品",   type: "product",   placeholder: "请选择私募基金产品", required: true  },
      { id: benchId, label: "对比基准",   type: "benchmark", placeholder: "如：沪深300",        required: false },
      { id: dateId,  label: "报告截止日", type: "date",      required: false },
    ],
    elements: [

      // ══════════════════════════════════════════════════════════════════════
      // HEADER BAND  (0 → 12%)
      // ══════════════════════════════════════════════════════════════════════

      // Navy background
      {
        id: "el_hdr_bg",
        type: "spacer",
        x: 0, y: 0, width: 100, height: 12,
        props: { style: { backgroundColor: "#1a2744", backgroundOpacity: 100, borderRadius: 0 } },
      },
      // Thin top border line (white 20 % opacity)
      {
        id: "el_hdr_topline",
        type: "spacer",
        x: 0, y: 0, width: 100, height: 0.22,
        props: { style: { backgroundColor: "#ffffff", backgroundOpacity: 15, borderRadius: 0 } },
      },
      // Left logo/brand box
      {
        id: "el_hdr_logo_bg",
        type: "spacer",
        x: 2.5, y: 2.2, width: 7, height: 7.6,
        props: {
          style: {
            backgroundColor: "#c0392b",
            backgroundOpacity: 100,
            borderRadius: 8,
          },
        },
      },
      {
        id: "el_hdr_logo_label",
        type: "subtitle",
        x: 2.5, y: 4.5, width: 7, height: 3,
        props: {
          text: "LOGO",
          fontSize: 13,
          align: "center",
          style: { textColor: "#ffffff", fontWeight: "bold", padding: 0 },
        },
      },
      // Main report title
      {
        id: "el_hdr_title",
        type: "title",
        x: 11.5, y: 1.8, width: 56, height: 5.5,
        props: {
          text: "私募基金季度投资报告",
          fontSize: 28,
          align: "left",
          style: { textColor: "#ffffff", fontWeight: "bold", padding: 0, letterSpacing: 2 },
        },
      },
      // English subtitle
      {
        id: "el_hdr_en",
        type: "subtitle",
        x: 11.5, y: 6.8, width: 56, height: 3,
        props: {
          text: "PRIVATE FUND QUARTERLY INVESTMENT REPORT",
          fontSize: 10,
          align: "left",
          style: { textColor: "#7fa4d0", padding: 0, letterSpacing: 1 },
        },
      },
      // Product name tag (bound)
      {
        id: "el_hdr_product",
        type: "subtitle",
        x: 11.5, y: 9.2, width: 56, height: 2.5,
        props: {
          text: "产品：—",
          bindInputId: pId,
          fontSize: 12,
          align: "left",
          style: { textColor: "#a8c7e8", padding: 0 },
        },
      },
      // Report date (right column)
      {
        id: "el_hdr_date_label",
        type: "subtitle",
        x: 74, y: 2.5, width: 23.5, height: 2.5,
        props: {
          text: "QUARTERLY REPORT",
          fontSize: 10,
          align: "right",
          style: { textColor: "#7fa4d0", padding: 0, letterSpacing: 1 },
        },
      },
      {
        id: "el_hdr_date",
        type: "date-display",
        x: 74, y: 5, width: 23.5, height: 4,
        props: {
          text: "截止日期",
          bindInputId: dateId,
          fontSize: 18,
          align: "right",
          style: { textColor: "#ffffff", fontWeight: "bold", padding: 0 },
        },
      },
      {
        id: "el_hdr_confidential",
        type: "text",
        x: 74, y: 9.2, width: 23.5, height: 2.5,
        props: {
          text: "CONFIDENTIAL",
          fontSize: 9,
          align: "right",
          style: { textColor: "#c0392b", fontWeight: "bold", padding: 0, letterSpacing: 2 },
        },
      },

      // Red bottom accent of header
      {
        id: "el_hdr_accent",
        type: "spacer",
        x: 0, y: 12, width: 100, height: 0.55,
        props: { style: { backgroundColor: "#c0392b", backgroundOpacity: 100, borderRadius: 0 } },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 1 — 核心指标摘要  (13% → 25%)
      // ══════════════════════════════════════════════════════════════════════

      sectionBar(13.5, 2.8, "el_s1_bar"),
      sectionLabel(13.5, 2.8, "el_s1_label", "核心指标摘要"),

      // 4 KPI metric-cards in a row (each 22.3% wide, gap 0.9%)
      {
        id: "el_kpi1",
        type: "metric-card",
        x: 2.5, y: 17, width: 22.3, height: 7.5,
        props: {
          bindProductInputId: pId,
          metricKey: "return_1y",
          metricLabel: "近一年收益",
          metricPeriod: "近一年",
          style: { ...card, padding: 16 },
        },
      },
      {
        id: "el_kpi2",
        type: "metric-card",
        x: 25.7, y: 17, width: 22.3, height: 7.5,
        props: {
          bindProductInputId: pId,
          metricKey: "max_drawdown",
          metricLabel: "最大回撤",
          metricPeriod: "成立以来",
          style: { ...card, padding: 16 },
        },
      },
      {
        id: "el_kpi3",
        type: "metric-card",
        x: 48.9, y: 17, width: 22.3, height: 7.5,
        props: {
          bindProductInputId: pId,
          metricKey: "sharpe_ratio",
          metricLabel: "夏普比率",
          metricPeriod: "近一年",
          style: { ...card, padding: 16 },
        },
      },
      {
        id: "el_kpi4",
        type: "metric-card",
        x: 72.1, y: 17, width: 22.3, height: 7.5,
        props: {
          bindProductInputId: pId,
          metricKey: "calmar_ratio",
          metricLabel: "卡玛比率",
          metricPeriod: "成立以来",
          style: { ...card, padding: 16 },
        },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 2 — 产品基本信息  (26% → 38%)
      // ══════════════════════════════════════════════════════════════════════

      sectionBar(26, 2.8, "el_s2_bar"),
      sectionLabel(26, 2.8, "el_s2_label", "产品基本信息"),

      {
        id: "el_pf_elements",
        type: "pf-product-elements",
        x: 2.5, y: 29.5, width: 95, height: 9.5,
        props: {
          bindProductInputId: pId,
          moduleSections: ["基本信息", "申赎信息", "费率结构"],
          chartPeriod: "成立以来",
          style: { ...card },
        },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 3 — 净值走势与业绩  (40% → 63%)
      // ══════════════════════════════════════════════════════════════════════

      sectionBar(40.5, 2.8, "el_s3_bar"),
      sectionLabel(40.5, 2.8, "el_s3_label", "净值走势与业绩表现"),

      // NAV chart (left 56.5%)
      {
        id: "el_nav_chart",
        type: "nav-chart",
        x: 2.5, y: 44, width: 56.5, height: 19.5,
        props: {
          bindProductInputId: pId,
          chartPeriod: "近一年",
          showLegend: true,
          showGrid: true,
          chartColor: "#c0392b",
          style: { ...card },
        },
      },

      // Performance indicators (right 37.5%)
      {
        id: "el_pf_perf",
        type: "pf-performance-indicators",
        x: 60.5, y: 44, width: 37, height: 19.5,
        props: {
          bindProductInputId: pId,
          moduleSections: ["净值曲线", "区间统计", "动态回撤"],
          chartPeriod: "近一年",
          style: { ...card },
        },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 4 — 区间业绩统计  (65% → 81%)
      // ══════════════════════════════════════════════════════════════════════

      sectionBar(65, 2.8, "el_s4_bar"),
      sectionLabel(65, 2.8, "el_s4_label", "区间业绩统计"),

      {
        id: "el_table",
        type: "table",
        x: 2.5, y: 68.5, width: 95, height: 13,
        props: {
          bindProductInputId: pId,
          tableRowSource: "single_product",
          tablePeriod: "近一年",
          tableStriped: true,
          tableShowIndex: false,
          tableCompact: false,
          tableHeaderBg: "#f0f4fa",
          tableColumns: [
            { id: "col_1", header: "产品名称",  source: "product_field", productField: "name",                align: "left",  format: "text",    widthWeight: 2.2 },
            { id: "col_2", header: "近一月",    source: "metric",        metricKey: "return_1m",              period: "近一月",   align: "right", format: "percent", widthWeight: 1 },
            { id: "col_3", header: "近三月",    source: "metric",        metricKey: "return_3m",              period: "近三月",   align: "right", format: "percent", widthWeight: 1 },
            { id: "col_4", header: "近六月",    source: "metric",        metricKey: "return_6m",              period: "近六月",   align: "right", format: "percent", widthWeight: 1 },
            { id: "col_5", header: "近一年",    source: "metric",        metricKey: "return_1y",              period: "近一年",   align: "right", format: "percent", widthWeight: 1 },
            { id: "col_6", header: "成立以来",  source: "metric",        metricKey: "return_since_inception", period: "成立以来", align: "right", format: "percent", widthWeight: 1 },
            { id: "col_7", header: "年化波动率", source: "metric",        metricKey: "annualized_volatility",  period: "成立以来", align: "right", format: "percent", widthWeight: 1 },
            { id: "col_8", header: "最大回撤",  source: "metric",        metricKey: "max_drawdown",           period: "成立以来", align: "right", format: "percent", widthWeight: 1 },
            { id: "col_9", header: "夏普比率",  source: "metric",        metricKey: "sharpe_ratio",           period: "近一年",   align: "right", format: "number",  widthWeight: 1 },
            { id: "col_10", header: "卡玛比率", source: "metric",        metricKey: "calmar_ratio",           period: "成立以来", align: "right", format: "number",  widthWeight: 1 },
          ],
          style: { ...card, padding: 0, borderRadius: 12 },
        },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 5 — 月度收益日历  (83% → 94%)
      // ══════════════════════════════════════════════════════════════════════

      sectionBar(83, 2.8, "el_s5_bar"),
      sectionLabel(83, 2.8, "el_s5_label", "月度收益日历"),

      {
        id: "el_monthly",
        type: "pf-monthly-returns",
        x: 2.5, y: 86.5, width: 95, height: 10.5,
        props: {
          bindProductInputId: pId,
          chartPeriod: "近两年",
          style: { ...card },
        },
      },

      // ══════════════════════════════════════════════════════════════════════
      // SECTION 6 — 动态回撤  (not shown here; remove if too long)
      // FOOTER: disclaimer & page info
      // ══════════════════════════════════════════════════════════════════════

      // Footer divider
      {
        id: "el_footer_divider",
        type: "divider",
        x: 2.5, y: 98, width: 95, height: 0.35,
        props: { dividerStyle: "solid", dividerThickness: 1, dividerColor: "#d1d5db" },
      },
      // Disclaimer
      {
        id: "el_disclaimer",
        type: "text",
        x: 2.5, y: 98.5, width: 95, height: 1.5,
        props: {
          text: "风险提示：本报告仅供参考，不构成投资建议。历史业绩不代表未来表现，投资有风险，请独立判断。",
          fontSize: 9,
          align: "center",
          style: { textColor: "#9ca3af", padding: 0 },
        },
      },

    ],
    updatedAt: DEMO_SEED_DATE,
  }
}

// Replace the demo template entry if the user hasn't edited it yet
// (updatedAt still equals the seed date → safe to overwrite with latest design).
function refreshDemo(list: ReportCustomTemplate[]): ReportCustomTemplate[] {
  return list.map((tpl) => {
    if (tpl.id === DEMO_TEMPLATE_ID && tpl.updatedAt <= DEMO_SEED_DATE) {
      return buildDemoTemplate()
    }
    return normalizeTemplate(tpl)
  })
}

export function loadReportTemplates(): ReportCustomTemplate[] {
  if (typeof window === "undefined") return []
  try {
    // ── v3 (current) ──────────────────────────────────────────────────────
    const rawV3 = localStorage.getItem(REPORT_TEMPLATES_STORAGE_KEY)
    if (rawV3) {
      const parsed = JSON.parse(rawV3)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list = refreshDemo(parsed as ReportCustomTemplate[])
        localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, JSON.stringify(list))
        return list
      }
    }

    // ── v2 migration ──────────────────────────────────────────────────────
    const rawV2 = localStorage.getItem("report_custom_templates_v2")
    if (rawV2) {
      const parsed = JSON.parse(rawV2)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list = refreshDemo(parsed as ReportCustomTemplate[])
        localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, JSON.stringify(list))
        return list
      }
    }

    // ── v1 migration ──────────────────────────────────────────────────────
    const rawV1 = localStorage.getItem("report_custom_templates_v1")
    if (rawV1) {
      const parsed = JSON.parse(rawV1)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list = refreshDemo(parsed as ReportCustomTemplate[])
        localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, JSON.stringify(list))
        return list
      }
    }

    // ── First run — seed with demo ─────────────────────────────────────────
    const demo = buildDemoTemplate()
    localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, JSON.stringify([demo]))
    return [demo]
  } catch {
    return [buildDemoTemplate()]
  }
}

export function saveReportTemplates(templates: ReportCustomTemplate[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, JSON.stringify(templates))
}
