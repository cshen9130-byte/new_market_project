import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  downloadReportArtifact,
  fetchReportNavRange,
  generateFofMonthlyReport,
  generateFofWeeklyReport,
  generateProductQuarterlyReport,
  searchReportProducts,
} from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { shareReportBytes } from "@/share-report"
import type { ReportGenerateResult, ReportKind, ReportNavFrequency, ReportProductOption } from "@/types"
import { colors } from "@/theme"

type Props = { onBack?: () => void }

type MonthlyLayout = "curve" | "review"

const BENCHMARK_OPTIONS = [
  { key: "IF", label: "沪深300" },
  { key: "510300.SH", label: "沪深300ETF" },
  { key: "IC", label: "中证500" },
  { key: "IM", label: "中证1000" },
  { key: "IH", label: "上证50" },
  { key: "511010.SH", label: "国债ETF" },
  { key: "518880.SH", label: "黄金ETF" },
  { key: "NHCI.NH", label: "南华商品指数" },
  { key: "100001.CCI", label: "中证商品指数" },
] as const

const QUARTER_BENCH1 = [
  { key: "000001.SH", label: "上证指数" },
  { key: "IF", label: "沪深300" },
  { key: "IC", label: "中证500" },
  { key: "IM", label: "中证1000" },
] as const

const NAV_FREQ_OPTIONS: { value: ReportNavFrequency; label: string }[] = [
  { value: "weekly", label: "周频" },
  { value: "daily", label: "日频" },
  { value: "monthly", label: "月频" },
]

function isoWeekBegin(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

function monthBegin(dateStr: string): string {
  const [year, month] = dateStr.split("-")
  return `${year}-${month}-01`
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

function lastCompleteQuarter(asOf: string): { start: string; end: string } {
  const [y, m] = asOf.split("-").map(Number)
  const thisQ = Math.floor((m - 1) / 3)
  const qEnd = lastDayOfMonth(y, thisQ * 3 + 3)
  const q = asOf >= qEnd ? thisQ : thisQ - 1
  const year = q < 0 ? y - 1 : y
  const qIndex = q < 0 ? 3 : q
  const startMonth = qIndex * 3 + 1
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, startMonth + 2),
  }
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

export default function FundReportsScreen({ onBack }: Props) {
  const [kind, setKind] = useState<ReportKind>("weekly")
  const [monthlyLayout, setMonthlyLayout] = useState<MonthlyLayout>("review")
  const [productQuery, setProductQuery] = useState("")
  const [productName, setProductName] = useState("")
  const [beianHao, setBeianHao] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ReportProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const [begin, setBegin] = useState("")
  const [end, setEnd] = useState("")
  const [reportTitle, setReportTitle] = useState("")
  const [benchmarkKey, setBenchmarkKey] = useState("IF")
  const [bench1Key, setBench1Key] = useState("000001.SH")
  const [bench2Key, setBench2Key] = useState("IF")
  const [navFrequency, setNavFrequency] = useState<ReportNavFrequency>("weekly")
  const [navStart, setNavStart] = useState<string | null>(null)
  const [navEnd, setNavEnd] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ReportGenerateResult | null>(null)
  const [previewUri, setPreviewUri] = useState<string | null>(null)
  const [sharing, setSharing] = useState<"png" | "pdf" | null>(null)
  const [status, setStatus] = useState("")

  const kindLabel = useMemo(() => {
    if (kind === "weekly") return "周报"
    if (kind === "monthly") return "月报"
    return "季报"
  }, [kind])

  useEffect(() => {
    const q = productQuery.trim()
    if (q.length < 1) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setSearching(true)
      searchReportProducts(q)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [productQuery])

  useEffect(() => {
    if (!productName.trim()) {
      setNavStart(null)
      setNavEnd(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetchReportNavRange({ kind, product_name: productName, beian_hao: beianHao })
        .then((range) => {
          if (cancelled) return
          setNavStart(range.start)
          setNavEnd(range.end)
          if (range.beian_hao && range.beian_hao !== beianHao) setBeianHao(range.beian_hao)
          if (range.end) {
            if (kind === "weekly") {
              setBegin(isoWeekBegin(range.end))
              setEnd(range.end)
            } else if (kind === "monthly") {
              setBegin(monthBegin(range.end))
              setEnd(range.end)
            } else {
              const q = lastCompleteQuarter(range.end)
              const start = range.start && q.start < range.start ? range.start : q.start
              const endDate = range.end && q.end > range.end ? range.end : q.end
              setBegin(start)
              setEnd(endDate)
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNavStart(null)
            setNavEnd(null)
          }
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [productName, beianHao, kind])

  const selectProduct = useCallback((opt: ReportProductOption) => {
    setProductName(opt.product_name)
    setBeianHao(opt.beian_hao)
    setProductQuery(opt.product_name)
    setSuggestions([])
    setReportTitle((prev) => prev || opt.product_name)
    setResult(null)
    setPreviewUri(null)
    setError("")
  }, [])

  const fillLatestPeriod = useCallback(() => {
    if (!navEnd) {
      setError("请先选择有净值数据的产品")
      return
    }
    if (kind === "weekly") {
      setBegin(isoWeekBegin(navEnd))
      setEnd(navEnd)
    } else if (kind === "monthly") {
      setBegin(monthBegin(navEnd))
      setEnd(navEnd)
    } else {
      const q = lastCompleteQuarter(navEnd)
      setBegin(navStart && q.start < navStart ? navStart : q.start)
      setEnd(q.end > navEnd ? navEnd : q.end)
    }
    setError("")
  }, [kind, navEnd, navStart])

  const handleGenerate = useCallback(async () => {
    if (!productName.trim()) {
      setError("请先选择产品")
      return
    }
    if (!begin || !end) {
      setError("请填写开始与结束日期（YYYY-MM-DD）")
      return
    }
    if (begin > end) {
      setError("开始日期不能晚于结束日期")
      return
    }
    setLoading(true)
    setError("")
    setStatus(`正在生成${kindLabel}…`)
    setResult(null)
    setPreviewUri(null)
    try {
      let next: ReportGenerateResult
      if (kind === "weekly") {
        next = await generateFofWeeklyReport({
          product_name: productName,
          beian_hao: beianHao,
          week_begin: begin,
          week_end: end,
          report_title: reportTitle,
          benchmark_key: benchmarkKey,
          nav_frequency: navFrequency,
        })
      } else if (kind === "monthly") {
        next = await generateFofMonthlyReport({
          product_name: productName,
          beian_hao: beianHao,
          month_begin: begin,
          month_end: end,
          report_title: reportTitle,
          benchmark_key: benchmarkKey,
          nav_frequency: navFrequency,
          report_layout: monthlyLayout,
        })
      } else {
        next = await generateProductQuarterlyReport({
          product_name: productName,
          beian_hao: beianHao,
          period_begin: begin,
          period_end: end,
          report_title: reportTitle,
          bench1_key: bench1Key,
          bench2_key: bench2Key,
          nav_frequency: navFrequency,
        })
      }
      setResult(next)
      if (next.previewDataUrl) {
        setPreviewUri(next.previewDataUrl)
      } else if (next.download?.png) {
        setStatus("正在加载预览图…")
        const file = await downloadReportArtifact(next.download.png)
        const b64 = (() => {
          const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
          let out = ""
          const bytes = file.bytes
          for (let i = 0; i < bytes.length; i += 3) {
            const a = bytes[i]
            const b = i + 1 < bytes.length ? bytes[i + 1] : 0
            const c = i + 2 < bytes.length ? bytes[i + 2] : 0
            const triplet = (a << 16) | (b << 8) | c
            out += chars[(triplet >> 18) & 63]
            out += chars[(triplet >> 12) & 63]
            out += i + 1 < bytes.length ? chars[(triplet >> 6) & 63] : "="
            out += i + 2 < bytes.length ? chars[triplet & 63] : "="
          }
          return out
        })()
        setPreviewUri(`data:${file.mime || "image/png"};base64,${b64}`)
      }
      setStatus("生成完成，可预览并分享到微信")
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败")
      setStatus("")
    } finally {
      setLoading(false)
    }
  }, [
    productName,
    beianHao,
    begin,
    end,
    reportTitle,
    benchmarkKey,
    bench1Key,
    bench2Key,
    navFrequency,
    monthlyLayout,
    kind,
    kindLabel,
  ])

  const handleShare = useCallback(
    async (format: "png" | "pdf") => {
      if (!result?.download?.[format]) {
        setError("没有可分享的文件，请先生成报告")
        return
      }
      setSharing(format)
      setError("")
      setStatus(format === "png" ? "正在准备图片…" : "正在准备 PDF…")
      try {
        const file = await downloadReportArtifact(result.download[format])
        const mime =
          file.mime ||
          (format === "png" ? "image/png" : "application/pdf")
        const name =
          file.filename ||
          `${result.reportTitle || productName || "报告"}.${format}`
        await shareReportBytes({ bytes: file.bytes, filename: name, mime })
        setStatus(
          Platform.OS === "web"
            ? `已下载 ${name}（浏览器端请自行转发微信）`
            : `已调起分享：${name}`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : "分享失败")
        setStatus("")
      } finally {
        setSharing(null)
      }
    },
    [result, productName],
  )

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
      </View>
      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>私募基金</Text>
          <Text style={styles.title}>报告</Text>
          <Text style={styles.lead}>
            生成与网站相同的周报 / 月报 / 季报图片与 PDF，可直接分享到微信。
          </Text>

          <Text style={styles.label}>报告类型</Text>
          <View style={styles.rowWrap}>
            <Chip label="周报" active={kind === "weekly"} onPress={() => { setKind("weekly"); setResult(null); setPreviewUri(null) }} />
            <Chip label="月报" active={kind === "monthly"} onPress={() => { setKind("monthly"); setResult(null); setPreviewUri(null) }} />
            <Chip label="季报" active={kind === "quarterly"} onPress={() => { setKind("quarterly"); setResult(null); setPreviewUri(null) }} />
          </View>

          {kind === "monthly" ? (
            <>
              <Text style={styles.label}>月报版式</Text>
              <View style={styles.rowWrap}>
                <Chip label="回顾版" active={monthlyLayout === "review"} onPress={() => setMonthlyLayout("review")} />
                <Chip label="曲线版" active={monthlyLayout === "curve"} onPress={() => setMonthlyLayout("curve")} />
              </View>
            </>
          ) : null}

          <Text style={styles.label}>产品</Text>
          <TextInput
            style={styles.input}
            value={productQuery}
            onChangeText={(v) => {
              setProductQuery(v)
              if (v !== productName) {
                setProductName("")
                setBeianHao(null)
              }
            }}
            placeholder="搜索在管 / 私募 / 对接产品"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
          />
          {searching ? <Text style={styles.hint}>搜索中…</Text> : null}
          {suggestions.length > 0 ? (
            <View style={styles.suggestBox}>
              {suggestions.slice(0, 8).map((opt) => (
                <Pressable
                  key={`${opt.source}:${opt.beian_hao || ""}:${opt.product_name}`}
                  style={styles.suggestRow}
                  onPress={() => selectProduct(opt)}
                >
                  <Text style={styles.suggestName}>{opt.product_name}</Text>
                  <Text style={styles.suggestMeta}>
                    {opt.source === "managed" ? "在管" : opt.source === "custom_fund" ? "对接" : "私募"}
                    {opt.beian_hao ? ` · ${opt.beian_hao}` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {productName ? (
            <Text style={styles.hint}>
              已选：{productName}
              {beianHao ? `（${beianHao}）` : ""}
              {navEnd ? ` · 最新净值 ${navEnd}` : ""}
            </Text>
          ) : null}

          <Text style={styles.label}>报告标题（可选）</Text>
          <TextInput
            style={styles.input}
            value={reportTitle}
            onChangeText={setReportTitle}
            placeholder="默认使用产品名"
            placeholderTextColor={colors.muted}
          />

          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <Text style={styles.label}>开始日期</Text>
              <TextInput
                style={styles.input}
                value={begin}
                onChangeText={setBegin}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.dateCol}>
              <Text style={styles.label}>结束日期</Text>
              <TextInput
                style={styles.input}
                value={end}
                onChangeText={setEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
            </View>
          </View>
          <Pressable onPress={fillLatestPeriod} style={styles.linkBtn}>
            <Text style={styles.linkText}>
              {kind === "weekly" ? "填入最近一周" : kind === "monthly" ? "填入最近一月" : "填入最近完整季度"}
            </Text>
          </Pressable>

          {kind !== "quarterly" ? (
            <>
              <Text style={styles.label}>业绩基准</Text>
              <View style={styles.rowWrap}>
                {BENCHMARK_OPTIONS.map((item) => (
                  <Chip
                    key={item.key}
                    label={item.label}
                    active={benchmarkKey === item.key}
                    onPress={() => setBenchmarkKey(item.key)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>基准一</Text>
              <View style={styles.rowWrap}>
                {QUARTER_BENCH1.map((item) => (
                  <Chip key={item.key} label={item.label} active={bench1Key === item.key} onPress={() => setBench1Key(item.key)} />
                ))}
              </View>
              <Text style={styles.label}>基准二</Text>
              <View style={styles.rowWrap}>
                {BENCHMARK_OPTIONS.slice(0, 5).map((item) => (
                  <Chip key={item.key} label={item.label} active={bench2Key === item.key} onPress={() => setBench2Key(item.key)} />
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>净值频率</Text>
          <View style={styles.rowWrap}>
            {NAV_FREQ_OPTIONS.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                active={navFrequency === item.value}
                onPress={() => setNavFrequency(item.value)}
              />
            ))}
          </View>

          <Pressable
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={styles.primaryBtnText}>生成{kindLabel}</Text>
            )}
          </Pressable>

          {status ? <Text style={styles.status}>{status}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {previewUri ? (
            <View style={styles.previewWrap}>
              <Text style={styles.label}>预览</Text>
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
            </View>
          ) : null}

          {result ? (
            <View style={styles.shareRow}>
              <Pressable
                style={[styles.secondaryBtn, sharing === "png" && styles.btnDisabled]}
                onPress={() => handleShare("png")}
                disabled={!!sharing}
              >
                {sharing === "png" ? (
                  <ActivityIndicator color={colors.gold} />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    {Platform.OS === "web" ? "下载图片" : "分享图片到微信"}
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, sharing === "pdf" && styles.btnDisabled]}
                onPress={() => handleShare("pdf")}
                disabled={!!sharing}
              >
                {sharing === "pdf" ? (
                  <ActivityIndicator color={colors.gold} />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    {Platform.OS === "web" ? "下载 PDF" : "分享 PDF 到微信"}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 22, paddingTop: 8 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  body: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 24, gap: 8 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  label: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.card || "transparent",
    fontSize: 15,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.12)" },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.gold },
  suggestBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    overflow: "hidden",
  },
  suggestRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 2,
  },
  suggestName: { color: colors.text, fontSize: 14, fontWeight: "600" },
  suggestMeta: { color: colors.muted, fontSize: 12 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateCol: { flex: 1, gap: 4 },
  linkBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  linkText: { color: colors.gold, fontSize: 13, fontWeight: "600" },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontSize: 16, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
  status: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: "#e35", fontSize: 13, lineHeight: 18 },
  previewWrap: { marginTop: 8, gap: 8 },
  preview: {
    width: "100%",
    height: 420,
    borderRadius: 12,
    backgroundColor: "#111",
  },
  shareRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.gold, fontSize: 13, fontWeight: "700" },
})
