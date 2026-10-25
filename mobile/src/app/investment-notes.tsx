import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "expo-router"
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fetchFund, fetchInvestmentNote, fetchInvestmentNotes, fetchPrivateFundProfile } from "@/api"
import { KeyboardSafe } from "@/components/KeyboardSafe"
import { NavChart } from "@/components/NavChart"
import { displayFundName, fmtDate, fmtNav, parseNum, strategyLine } from "@/format"
import type {
  FundDetail,
  InvestmentNoteAssociation,
  InvestmentNoteDetail,
  InvestmentNoteListItem,
  InvestmentNoteRoadshowAssociation,
  NavPoint,
  PrivateFundProfile,
} from "@/types"
import { colors } from "@/theme"

type Props = { onBack?: () => void }

const PRIVATE_FUND_CATEGORY = "私募基金"

export default function InvestmentNotesScreen({ onBack }: Props) {
  const [keyword, setKeyword] = useState("")
  const [rows, setRows] = useState<InvestmentNoteListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [active, setActive] = useState<InvestmentNoteDetail | null>(null)
  const [opening, setOpening] = useState(false)

  const load = useCallback(async () => {
    setError("")
    const list = await fetchInvestmentNotes("team")
    const sorted = [...list].sort((a, b) =>
      String(b.modifiedDate || b.createdDate || "").localeCompare(String(a.modifiedDate || a.createdDate || "")),
    )
    setRows(sorted)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch((err: unknown) => {
        if (!cancelled) {
          setRows([])
          setError(err instanceof Error ? err.message : "加载失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setRefreshing(false)
    }
  }

  async function openNote(item: InvestmentNoteListItem) {
    setOpening(true)
    try {
      const note = await fetchInvestmentNote(item.id)
      setActive(note)
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开失败")
    } finally {
      setOpening(false)
    }
  }

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const blob = [row.title, row.preview, row.creator, row.sourceLabel, ...(row.tags || [])]
        .map((part) => String(part || "").toLowerCase())
        .join(" ")
      return blob.includes(q)
    })
  }, [rows, keyword])

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardSafe>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {onBack ? (
              <Pressable onPress={onBack} hitSlop={12}>
                <Text style={styles.back}>返回</Text>
              </Pressable>
            ) : null}
            <View>
              <Text style={styles.eyebrow}>投资</Text>
              <Text style={styles.title}>投资笔记</Text>
            </View>
          </View>
          <Text style={styles.count}>{filtered.length > 0 ? `${filtered.length}` : ""}</Text>
        </View>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索标题、标签或作者"
          placeholderTextColor="#A39E96"
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.up} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : styles.list}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.up} style={{ marginTop: 40 }} />
            ) : error ? (
              <View />
            ) : (
              <Text style={styles.empty}>暂无投资笔记</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openNote(item)} disabled={opening}>
              <View style={styles.rowMain}>
                <Text style={styles.name} numberOfLines={2}>{item.title || "未命名笔记"}</Text>
                <Text style={styles.meta} numberOfLines={2}>{previewText(item.preview) || "暂无摘要"}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[item.creator || item.lastModifiedBy, (item.modifiedDate || item.createdDate || "").slice(0, 10), item.sourceLabel]
                    .filter(Boolean)
                    .join("  ·  ")}
                </Text>
              </View>
              <Text style={styles.go}>查看</Text>
            </Pressable>
          )}
        />
      </KeyboardSafe>

      <Modal visible={!!active} animationType="slide" onRequestClose={() => setActive(null)}>
        <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <Pressable onPress={() => setActive(null)} hitSlop={12}>
              <Text style={styles.back}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.detail} keyboardShouldPersistTaps="handled">
            <Text style={styles.detailTitle}>{active?.title || "未命名笔记"}</Text>
            <Text style={styles.meta}>
              {[active?.creator || active?.lastModifiedBy, (active?.modifiedDate || active?.createdDate || "").slice(0, 10)]
                .filter(Boolean)
                .join("  ·  ")}
            </Text>

            {active ? <NoteAssociationsBlock note={active} /> : null}

            <NoteBody content={active?.content || active?.preview || ""} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function NoteAssociationsBlock({ note }: { note: InvestmentNoteDetail }) {
  const associations = note.associations || []
  const roadshows = note.roadshowAssociations || []
  if (associations.length === 0 && roadshows.length === 0) return null

  const productAssocs = associations.filter(
    (item) => item.category === PRIVATE_FUND_CATEGORY && String(item.recordNo || "").trim(),
  )
  return (
    <View style={styles.assocBlock}>
      <Text style={styles.assocLabel}>关联产品</Text>
      <View style={styles.chipRow}>
        {associations.length === 0 ? (
          <Text style={styles.meta}>暂无</Text>
        ) : (
          associations.map((item) => (
            <AssociationChip key={`${item.category}-${item.recordNo || item.name}`} item={item} />
          ))
        )}
      </View>

      {productAssocs.map((item) => (
        <AssociatedProductCard key={`card-${item.recordNo}`} association={item} />
      ))}

      {roadshows.length > 0 ? (
        <>
          <Text style={[styles.assocLabel, { marginTop: 12 }]}>关联路演</Text>
          <View style={styles.chipRow}>
            {roadshows.map((item) => (
              <View key={item.rowId} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {roadshowLabel(item)}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  )
}

function AssociationChip({ item }: { item: InvestmentNoteAssociation }) {
  const label = associationDisplayLabel(item)
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function AssociatedProductCard({ association }: { association: InvestmentNoteAssociation }) {
  const router = useRouter()
  const beian = String(association.recordNo || "").trim()
  const [detail, setDetail] = useState<FundDetail | null>(null)
  const [profile, setProfile] = useState<PrivateFundProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!beian) return
    let cancelled = false
    setLoading(true)
    setError("")
    Promise.all([
      fetchFund(beian),
      fetchPrivateFundProfile(beian).then(
        (prof) => ({ ok: true as const, prof }),
        (err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : "档案加载失败",
        }),
      ),
    ])
      .then(([fund, profResult]) => {
        if (cancelled) return
        setDetail(fund)
        if (profResult.ok) {
          setProfile(profResult.prof)
        } else {
          setProfile(null)
          setError(profResult.error)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [beian])

  const title =
    (detail?.info ? displayFundName(detail.info.product_name, detail.info.short_name) : "") ||
    profile?.fund_name?.trim() ||
    association.name ||
    beian
  const chart = useMemo(() => buildReturnChart(detail?.nav_series ?? []), [detail])
  const metrics = detail?.metrics
  const info = detail?.info

  return (
    <View style={styles.productCard}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.productCardHeader}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.productTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.meta}>{beian}</Text>
        </View>
        <Text style={styles.go}>{expanded ? "收起" : "展开"}</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={colors.up} style={{ marginVertical: 16 }} />
      ) : error && !detail ? (
        <Text style={styles.error}>{error}</Text>
      ) : expanded ? (
        <View style={styles.productBody}>
          <View style={styles.navHero}>
            <Text style={styles.navValue}>{fmtNav(metrics?.latest_nav)}</Text>
            <Text style={styles.meta}>单位净值 · {fmtDate(metrics?.latest_nav_date)}</Text>
            <Text style={styles.meta}>
              累计 {fmtNav(metrics?.latest_cum_nav)} · 复权 {fmtNav(metrics?.latest_cum_nav_reinvested)}
            </Text>
          </View>

          {chart.length >= 2 ? (
            <View style={styles.chartWrap}>
              <Text style={styles.sectionTitle}>净值走势</Text>
              <NavChart points={chart} />
            </View>
          ) : (
            <Text style={[styles.meta, { marginBottom: 8 }]}>暂无净值序列</Text>
          )}

          <View style={styles.sectionHead}>
            <View style={styles.sectionDot} />
            <Text style={styles.sectionTitle}>基本信息</Text>
          </View>
          <ElementRows
            rows={[
              {
                left: { label: "基金全称", value: profile?.fund_name || title },
                right: { label: "基金类型", value: profile?.fund_type || info?.strategy_l1 },
              },
              {
                left: { label: "投资顾问", value: profile?.advisor || info?.manager },
                right: {
                  label: "基金管理人",
                  value: profile?.fund_manager || info?.manager_names || info?.manager,
                },
              },
              {
                left: { label: "备案编号", value: profile?.register_number || beian },
                right: {
                  label: "成立/运作日期",
                  value: joinDates(profile?.inception_date || info?.inception_date, profile?.operation_date),
                },
              },
              {
                left: { label: "托管券商", value: profile?.custodian },
                right: { label: "备案日期", value: profile?.puton_date },
              },
              {
                left: {
                  label: "策略",
                  value: strategyLine([info?.strategy_l1, info?.strategy_l2, info?.strategy_l3]),
                },
              },
            ]}
          />

          <View style={[styles.sectionHead, { marginTop: 14 }]}>
            <View style={styles.sectionDot} />
            <Text style={styles.sectionTitle}>产品要素 · 申赎信息</Text>
            {profile?.updated_at ? (
              <Text style={styles.sectionMeta}>更新 {String(profile.updated_at).slice(0, 10)}</Text>
            ) : null}
          </View>

          {/* 申购赎回开放日 — highlighted like website open_day */}
          <View style={styles.openDayBox}>
            <Text style={styles.openDayLabel}>申购赎回开放日</Text>
            <Text style={styles.openDayValue}>{displayOrDash(profile?.open_day)}</Text>
          </View>

          <ElementRows
            rows={[
              {
                left: { label: "开放日", value: profile?.open_day, multiline: true },
                right: { label: "是否可赎回", value: profile?.redeemable_status },
              },
              {
                left: { label: "申购费", value: profile?.fee_purchase },
                right: { label: "追加申购限制", value: profile?.add_amount, multiline: true },
              },
              {
                left: { label: "赎回费", value: profile?.fee_redeem, multiline: true },
                right: { label: "风险等级", value: profile?.risk_level },
              },
              {
                left: { label: "预警线", value: profile?.precautious_line },
                right: { label: "封闭期", value: profile?.closed_period },
              },
              {
                left: { label: "止损线", value: profile?.stop_line },
                right: { label: "锁定期说明", value: profile?.lock_period_desc, multiline: true },
              },
              {
                left: { label: "管理费率", value: profile?.fee_manage_rate },
                right: { label: "托管费", value: profile?.fee_trust },
              },
              {
                left: { label: "管理费说明", value: profile?.fee_manage, multiline: true },
                right: { label: "外包费", value: profile?.fee_admin_service },
              },
            ]}
          />
          <ElementFullRows
            rows={[
              { label: "业绩报酬说明", value: profile?.fee_pay },
              { label: "业绩报酬公式", value: profile?.fee_pay_formula },
            ]}
          />
          {!profile ? (
            <Text style={[styles.meta, { marginTop: 8 }]}>产品要素档案暂未加载，可点下方进入产品页查看</Text>
          ) : null}

          <Pressable
            style={styles.openFundBtn}
            onPress={() => router.push(`/fund/${encodeURIComponent(beian)}`)}
          >
            <Text style={styles.openFundText}>查看产品详情</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.productCollapsed}>
          <Text style={styles.navValueSmall}>{fmtNav(metrics?.latest_nav)}</Text>
          <Text style={styles.meta}>{fmtDate(metrics?.latest_nav_date)}</Text>
          <Pressable onPress={() => router.push(`/fund/${encodeURIComponent(beian)}`)}>
            <Text style={styles.go}>详情</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

function displayOrDash(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  return s || "—"
}

/** Website-style two-column element rows; empty values still show as — so the card looks complete. */
function ElementRows({
  rows,
  showEmpty = true,
}: {
  rows: Array<{
    left: { label: string; value: string | null | undefined; multiline?: boolean }
    right?: { label: string; value: string | null | undefined; multiline?: boolean }
  }>
  showEmpty?: boolean
}) {
  const filtered = showEmpty
    ? rows
    : rows.filter((row) => {
        const left = String(row.left.value ?? "").trim()
        const right = row.right ? String(row.right.value ?? "").trim() : ""
        return Boolean(left || right)
      })
  if (filtered.length === 0) {
    return <Text style={styles.meta}>暂无档案信息</Text>
  }
  return (
    <View style={styles.elementTable}>
      {filtered.map((row) => (
        <View key={`${row.left.label}-${row.right?.label || ""}`} style={styles.elementRow}>
          <ElementCell item={row.left} borderedRight={Boolean(row.right)} />
          {row.right ? <ElementCell item={row.right} /> : null}
        </View>
      ))}
    </View>
  )
}

function ElementFullRows({
  rows,
  showEmpty = true,
}: {
  rows: Array<{ label: string; value: string | null | undefined }>
  showEmpty?: boolean
}) {
  const filtered = showEmpty ? rows : rows.filter((row) => String(row.value ?? "").trim())
  if (filtered.length === 0) return null
  return (
    <View style={styles.elementTable}>
      {filtered.map((row) => (
        <View key={row.label} style={styles.elementFullRow}>
          <Text style={styles.elementLabel}>{row.label}</Text>
          <Text style={styles.elementValueFull}>{displayOrDash(row.value)}</Text>
        </View>
      ))}
    </View>
  )
}

function ElementCell({
  item,
  borderedRight,
}: {
  item: { label: string; value: string | null | undefined; multiline?: boolean }
  borderedRight?: boolean
}) {
  return (
    <View style={[styles.elementCell, borderedRight ? styles.elementCellBorder : null]}>
      <Text style={styles.elementLabel}>{item.label}</Text>
      <Text style={item.multiline ? styles.elementValueMulti : styles.elementValue}>
        {displayOrDash(item.value)}
      </Text>
    </View>
  )
}

function InfoGrid({ items }: { items: Array<{ label: string; value: string | null | undefined }> }) {
  const visible = items.filter((item) => String(item.value || "").trim())
  if (visible.length === 0) {
    return <Text style={styles.meta}>暂无档案信息</Text>
  }
  return (
    <View style={styles.infoGrid}>
      {visible.map((item) => (
        <View key={item.label} style={styles.infoCell}>
          <Text style={styles.infoLabel}>{item.label}</Text>
          <Text style={styles.infoValue}>{String(item.value).trim()}</Text>
        </View>
      ))}
    </View>
  )
}

function NoteBody({ content }: { content: string }) {
  const blocks = useMemo(() => htmlToBlocks(content), [content])
  if (blocks.length === 0) {
    return <Text style={styles.detailBody}>暂无正文</Text>
  }
  return (
    <View style={styles.bodyBlocks}>
      {blocks.map((block, index) => (
        <Text
          key={`${index}-${block.kind}`}
          style={block.kind === "heading" ? styles.bodyHeading : styles.detailBody}
        >
          {block.text || " "}
        </Text>
      ))}
    </View>
  )
}

function associationDisplayLabel(item: InvestmentNoteAssociation): string {
  const name = String(item.name || "").trim() || "未命名"
  if (item.category === PRIVATE_FUND_CATEGORY) return name
  const short = CATEGORY_SHORT[item.category] || item.category
  return short ? `${name}(${short})` : name
}

function roadshowLabel(item: InvestmentNoteRoadshowAssociation): string {
  return (
    String(item.label || "").trim() ||
    [item.ddDate, item.fundCompany || item.ddTarget || item.representativeProduct].filter(Boolean).join(" ") ||
    item.rowId
  )
}

const CATEGORY_SHORT: Record<string, string> = {
  私募基金: "私募",
  公募基金: "公募",
  团队对接: "对接",
  私募管理人: "管理人",
  公募管理公司: "管理公司",
}

function joinDates(a?: string | null, b?: string | null): string | null {
  const left = a ? String(a).slice(0, 10) : ""
  const right = b ? String(b).slice(0, 10) : ""
  if (left && right) return `${left} / ${right}`
  return left || right || null
}

function buildReturnChart(rows: NavPoint[]): { date: string; value: number }[] {
  const points = rows
    .map((row) => {
      const raw = parseNum(row.cumulative_nav) ?? parseNum(row.cum_nav_withdrawal) ?? parseNum(row.nav)
      if (raw == null || raw <= 0) return null
      const date = String(row.price_date || "").slice(0, 10)
      if (!date) return null
      return { date, value: raw }
    })
    .filter((point): point is { date: string; value: number } => point != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2) return []
  // keep roughly last year of points for the card
  const cutoff = points[points.length - 1].date
  const yearAgo = shiftYear(cutoff, -1)
  const windowed = points.filter((p) => p.date >= yearAgo)
  const series = windowed.length >= 2 ? windowed : points
  const base = series[0].value
  const indexed = series.map((point) => ({ date: point.date, value: (point.value / base - 1) * 100 }))
  return downsample(indexed, 120)
}

function shiftYear(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  d.setFullYear(d.getFullYear() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function downsample(rows: { date: string; value: number }[], max: number) {
  if (rows.length <= max) return rows
  const step = (rows.length - 1) / (max - 1)
  const out: { date: string; value: number }[] = []
  for (let i = 0; i < max; i += 1) {
    out.push(rows[Math.round(i * step)])
  }
  return out
}

type BodyBlock = { kind: "heading" | "para"; text: string }

function isRichHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content)
}

function decodeEntities(raw: string): string {
  return String(raw || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
}

/** Preserve paragraph / heading breaks; do NOT collapse all whitespace into one line. */
function htmlToPlainPreservingBlocks(raw: string): string {
  let s = String(raw || "")
  if (!s.trim()) return ""
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "")
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "")
  s = s.replace(/<br\s*\/?>/gi, "\n")
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>/gi, "\n")
  s = s.replace(/<(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)(\s[^>]*)?>/gi, "\n")
  s = s.replace(/<\/?(ul|ol|table|thead|tbody|tfoot|hr)[^>]*>/gi, "\n")
  s = s.replace(/<[^>]+>/g, "")
  s = decodeEntities(s)
  s = s.replace(/[^\S\n]+/g, " ")
  s = s.replace(/ *\n */g, "\n")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

function htmlToBlocks(raw: string): BodyBlock[] {
  const plain = isRichHtml(raw) ? htmlToPlainPreservingBlocks(raw) : decodeEntities(String(raw || "")).replace(/\r\n/g, "\n")
  if (!plain.trim()) return []
  const lines = plain.split("\n")
  const blocks: BodyBlock[] = []
  for (const line of lines) {
    const text = line.trimEnd()
    if (!text.trim()) {
      // keep a blank spacer between paragraphs
      if (blocks.length > 0 && blocks[blocks.length - 1].text !== "") {
        blocks.push({ kind: "para", text: "" })
      }
      continue
    }
    const trimmed = text.trim()
    const heading =
      /^[一二三四五六七八九十百千]+、/.test(trimmed) ||
      /^[0-9]+\.\s/.test(trimmed) ||
      trimmed === "相关附件" ||
      /^#{1,3}\s/.test(trimmed)
    blocks.push({ kind: heading ? "heading" : "para", text: trimmed.replace(/^#+\s*/, "") })
  }
  // drop trailing blank
  while (blocks.length && !blocks[blocks.length - 1].text.trim()) blocks.pop()
  return blocks
}

function previewText(raw?: string): string {
  if (!raw) return ""
  const plain = isRichHtml(raw) ? htmlToPlainPreservingBlocks(raw) : decodeEntities(raw)
  return plain.replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ").trim()
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 22, paddingTop: 8 },
  headerLeft: { gap: 8 },
  back: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  eyebrow: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  count: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  search: {
    marginHorizontal: 22,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, marginHorizontal: 22, marginTop: 8 },
  list: { paddingBottom: 16 },
  emptyWrap: { flexGrow: 1 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 56 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  go: { color: colors.gold, fontSize: 12, letterSpacing: 1, fontWeight: "700" },
  detail: { paddingHorizontal: 22, paddingBottom: 48, gap: 12 },
  detailTitle: { fontSize: 24, fontWeight: "700", color: colors.text, lineHeight: 32 },
  detailBody: { color: colors.text, fontSize: 15, lineHeight: 26 },
  bodyBlocks: { gap: 8, marginTop: 4 },
  bodyHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 26,
    marginTop: 10,
  },
  assocBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
    paddingVertical: 12,
    gap: 8,
  },
  assocLabel: { color: "#0284C7", fontSize: 13, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  chipText: { color: "#EF4444", fontSize: 12 },
  productCard: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: "hidden",
  },
  productCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  productTitle: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 22 },
  productBody: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  productCollapsed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navHero: { gap: 2, marginBottom: 8 },
  navValue: { fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.5 },
  navValueSmall: { fontSize: 18, fontWeight: "700", color: colors.text },
  chartWrap: { marginBottom: 8 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.up,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  sectionMeta: { marginLeft: "auto", fontSize: 10, color: colors.muted },
  openDayBox: {
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    gap: 4,
  },
  openDayLabel: { fontSize: 11, fontWeight: "700", color: "#B91C1C", letterSpacing: 0.5 },
  openDayValue: { fontSize: 13, color: colors.text, lineHeight: 20 },
  elementTable: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
  },
  elementRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  elementFullRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  elementCell: { flex: 1, minWidth: 0 },
  elementCellBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line },
  elementLabel: {
    fontSize: 11,
    color: colors.muted,
    backgroundColor: "#F7F3EC",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  elementValue: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  elementValueMulti: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 19,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  elementValueFull: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
    lineHeight: 19,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  infoCell: { width: "47%", gap: 2 },
  infoLabel: { fontSize: 11, color: colors.muted },
  infoValue: { fontSize: 12, color: colors.text, lineHeight: 17 },
  openFundBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  openFundText: { color: colors.gold, fontSize: 13, fontWeight: "700" },
})
