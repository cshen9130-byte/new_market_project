/**
 * Aggregate status for 运维 → 数据维护 → 数据概览.
 *
 * 净值 is the later of the product-page team date and the platform date.
 * 全库 / 平台数据 / 跟踪池 take that date in SQL. 团队数据 takes the fund-page
 * date and the platform `latest_nav_date`, then keeps the later one.
 * 跟踪池 gap, anomaly and 成立对齐 use the list rules when the pool is small enough to scan.
 */

import { query } from "@/lib/db"
import {
  DATA_OVERVIEW_SCOPES,
  WEEK_BUCKETS,
  WEEK_BUCKET_LABEL,
  emptyInceptionGapCounts,
  emptyWeekCounts,
  laterNavDate,
  navDateBucket,
  overviewRows,
  shanghaiToday,
  weekBucket,
  type DataOverviewResponse,
  type DataOverviewScope,
  type DataOverviewSection,
  type InceptionGapBucket,
  type WeekBucket,
} from "@/lib/ops-data-overview"
import {
  PLATFORM_PRIVATE_CLASS_SQL,
  PLATFORM_PRODUCT_CLASS_CASE_SQL,
} from "@/lib/server/platform-data-query-pg"
import { NAV_SERIES_FLAG_RULE, loadFreshNavSeriesFlags } from "@/lib/server/nav-series-flags-pg"
import { setListResponseCache, withListResponseCache } from "@/lib/server/list-response-cache"
import type { NavAnomalyHit } from "@/lib/server/nav-anomaly"
import {
  assessPlatformNavSeries,
  attachNavAnomalyDiagnosis,
  loadBeianCodesWithOperationDate,
  loadInceptionNavAlignment,
  matchesInceptionNavGap,
  summarizeTeamDataStatus,
  type PlatformFundSeed,
} from "@/lib/server/team-data-query-pg"

const SCOPE_META: Record<DataOverviewScope, { label: string; description: string }> = {
  all: {
    label: "全库",
    description: "私募基金库中的全部产品。更新方式、要素和运作日期与列表筛选使用同一规则。净值取产品页上团队净值与平台净值中较新的一天。",
  },
  platform: {
    label: "平台数据",
    description: "产品分类为私募基金的全部产品，包含还没有净值的产品。净值取产品页上团队净值与平台净值中较新的一天。",
  },
  team: {
    label: "团队数据",
    description: "团队数据在筛选全部为「不限」时的产品。更新方式、要素、运作日期、成立对齐、净值断档和净值异常与列表筛选使用同一规则。净值取产品页上团队净值与平台净值中较新的一天。",
  },
  tracking: {
    label: "跟踪池",
    description: "JY跟踪池中的产品。净值断档、净值异常和成立对齐按列表上的同一规则统计。净值取产品页上团队净值与平台净值中较新的一天。",
  },
}

const LIVE_SERIES_CAP = 2500

type WeekCounts = Record<WeekBucket, number>

type OverviewCounts = {
  total: number
  inPool: number
  update: { email: number; manual: number; fof99: number; other: number }
  navFreshness: WeekCounts
  navPresence: { present: number; absent: number }
  navDate: { m1: number; m1_3: number; m3_6: number; over_m6: number; none: number }
  elements: { present: number; missing: number }
  operationDate: { present: number; absent: number }
  valuation: { present: number; absent: number }
  inception: { match: number; mismatch: number; missing: number } | null
  inceptionGap: Record<InceptionGapBucket, number> | null
  navGap: { interior: number; clear: number; unchecked: number }
  anomaly: { jump: number; clear: number; unchecked: number; source: number; rules: number; unknown: number }
  productClass: { private: number; equity: number; trust: number; asset: number; unknown: number }
  seriesLive: boolean
}

type SqlCountRow = {
  total: number
  in_pool: number
  email_n: number
  manual_n: number
  fof99_n: number
  update_none: number
  nav_w0: number
  nav_w1: number
  nav_w2: number
  nav_w3: number
  nav_m1_3: number
  nav_m3_6: number
  nav_over_m6: number
  nav_none: number
  nav_present: number
  nav_absent: number
  date_m1: number
  date_m1_3: number
  date_m3_6: number
  date_over_m6: number
  date_none: number
  elements_present: number
  elements_missing: number
  operation_present: number
  operation_absent: number
  valuation_present: number
  valuation_absent: number
  class_private: number
  class_equity: number
  class_trust: number
  class_asset: number
  class_unknown: number
  gap_yes: number
  gap_no: number
  gap_unchecked: number
  anomaly_yes: number
  anomaly_no: number
  anomaly_unchecked: number
  cause_source: number
  cause_rules: number
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dataListHref(
  scope: DataOverviewScope,
  params: Record<string, string>,
  kind: "team" | "platform" | "both",
): string | undefined {
  if (scope === "tracking") return undefined
  if (kind === "team" && scope !== "team") return undefined
  if (kind === "platform" && scope === "team") return undefined
  if (scope === "team") {
    const query = new URLSearchParams({ tab: "operations", side: "ops-team-data", ...params })
    return `/ma/dashboard/private-funds?${query}`
  }
  const query = new URLSearchParams({
    tab: "operations",
    side: "ops-platform-data",
    product_class: scope === "platform" ? "private" : "all",
    nav_presence: "all",
    ...params,
  })
  return `/ma/dashboard/private-funds?${query}`
}

function weekRows(counts: WeekCounts, total: number, noneLabel: string) {
  return overviewRows(total, WEEK_BUCKETS.map((key) => ({
    key,
    label: key === "none" ? noneLabel : WEEK_BUCKET_LABEL[key],
    count: counts[key],
  })))
}

function sectionsFor(scope: DataOverviewScope, counts: OverviewCounts): DataOverviewSection[] {
  const total = counts.total
  const gapHint = counts.seriesLive
    ? "与列表「净值断档」使用同一规则：从运作日（未填则用首个净值日）到最近净值日，按交易日估算缺失超过一成应有净值。"
    : "与列表「净值断档」使用同一规则。尚未写入检测缓存的产品计入未检测；在平台数据中打开净值断档筛选后，这里会补上检测结果。"
  const anomalyHint = counts.seriesLive
    ? "与列表「净值异常」使用同一规则：常见披露间隔内相邻涨跌达到 30% 算跳变，约一个月内翻倍或腰斩、以及相对前后都偏了 15% 以上的尖刺也算。平时一步很小、前后回到同一水平的 5% 尖刺也算。"
    : "与列表「净值异常」使用同一规则。尚未写入检测缓存的产品计入未检测；在平台数据中打开净值异常筛选后，这里会补上检测结果。"

  const gapHref = counts.navGap.unchecked === 0
  const anomalyHref = counts.anomaly.unchecked === 0
  const sections: DataOverviewSection[] = [
    {
      key: "tracking",
      title: "跟踪池",
      hint: "备案号在 JY跟踪池中的产品。",
      rows: overviewRows(total, [
        { key: "in", label: "在跟踪池", count: counts.inPool },
        ...(scope === "tracking" ? [] : [{ key: "out", label: "不在跟踪池", count: Math.max(0, total - counts.inPool) }]),
      ]),
    },
    {
      key: "update_method",
      title: "更新方式",
      hint: scope === "team"
        ? "最新一条净值或估值表的写入渠道，与团队数据「更新方式」一致。同一天优先手动更新，其次邮箱抓取，再次 fof99。"
        : "按备案号上最新一条邮箱净值、手动净值、fof99 或估值表的日期归类。同一天优先手动更新，其次邮箱抓取，再次 fof99。没有任何这些记录的计入无团队更新。",
      rows: overviewRows(total, [
        { key: "email", label: "邮箱抓取", count: counts.update.email, href: dataListHref(scope, { product_source: "email" }, "team") },
        { key: "manual", label: "手动更新", count: counts.update.manual, href: dataListHref(scope, { product_source: "manual" }, "team") },
        { key: "fof99", label: "fof99", count: counts.update.fof99, href: dataListHref(scope, { product_source: "fof99" }, "team") },
        ...(counts.update.other > 0 || scope !== "team"
          ? [{ key: "other", label: "无团队更新", count: counts.update.other }]
          : []),
      ]),
    },
    {
      key: "nav",
      title: "净值",
      hint: "产品页上的净值。团队净值或平台净值任一有日期，或平台单位净值有值，即算有净值。",
      rows: overviewRows(total, [
        { key: "present", label: "有净值", count: counts.navPresence.present },
        { key: "absent", label: "无净值", count: counts.navPresence.absent },
      ]),
    },
    {
      key: "nav_freshness",
      title: "净值新鲜度",
      hint: "取产品页上团队净值日期与平台净值日期中较新的一天。最新一周为 7 天内，滞后 1 周为 8 到 14 天，其后按周再按自然月。两边都没有日期时计入无净值日期。",
      rows: weekRows(counts.navFreshness, total, "无净值日期"),
    },
    {
      key: "nav_date",
      title: "净值日期",
      hint: "同一较新日期按自然月划分。6个月以内是前三项合计。没有日期时计入无净值日期。",
      rows: overviewRows(total, [
        { key: "m1", label: "1个月以内", count: counts.navDate.m1 },
        { key: "m1_3", label: "1-3个月", count: counts.navDate.m1_3 },
        { key: "m3_6", label: "3-6个月", count: counts.navDate.m3_6 },
        { key: "over_m6", label: "6个月以上", count: counts.navDate.over_m6 },
        { key: "none", label: "无净值日期", count: counts.navDate.none },
      ]),
    },
    {
      key: "elements",
      title: "产品要素",
      hint: "申赎、费用、开放日等要素是否已填写，与「产品要素」筛选一致。",
      rows: overviewRows(total, [
        { key: "present", label: "有要素", count: counts.elements.present, href: dataListHref(scope, { elements: "present" }, "both") },
        { key: "missing", label: "缺失要素", count: counts.elements.missing, href: dataListHref(scope, { elements: "missing" }, "both") },
      ]),
    },
    {
      key: "operation_date",
      title: "运作日期",
      hint: "是否已填写运作日期，与「运作日期」筛选一致。",
      rows: overviewRows(total, [
        { key: "present", label: "有", count: counts.operationDate.present, href: dataListHref(scope, { operation_date: "present" }, "both") },
        { key: "absent", label: "无", count: counts.operationDate.absent, href: dataListHref(scope, { operation_date: "absent" }, "both") },
      ]),
    },
    {
      key: "valuation",
      title: "估值表",
      hint: "估值表记录里是否出现该备案号。",
      rows: overviewRows(total, [
        { key: "present", label: "有估值表", count: counts.valuation.present },
        { key: "absent", label: "无估值表", count: counts.valuation.absent },
      ]),
    },
  ]

  if (counts.inception && counts.inceptionGap) {
    sections.push(
      {
        key: "inception",
        title: "成立对齐",
        hint: "净值起始日与产品成立日是否为同一天，与团队数据「成立对齐」筛选一致。",
        rows: overviewRows(total, [
          { key: "match", label: "一致", count: counts.inception.match, href: dataListHref(scope, { inception_nav: "match" }, "team") },
          { key: "mismatch", label: "不一致", count: counts.inception.mismatch, href: dataListHref(scope, { inception_nav: "mismatch" }, "team") },
          { key: "missing", label: "缺失", count: counts.inception.missing, href: dataListHref(scope, { inception_nav: "missing" }, "team") },
        ]),
      },
      {
        key: "inception_gap",
        title: "成立日相差",
        hint: "只统计成立对齐为不一致的产品，区间与「相差」筛选一致。占比相对当前范围内的全部产品。",
        rows: overviewRows(total, [
          { key: "w2", label: "两周内", count: counts.inceptionGap.w2, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "w2" }, "team") },
          { key: "w2_m1", label: "两周至一个月", count: counts.inceptionGap.w2_m1, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "w2_m1" }, "team") },
          { key: "m1_3", label: "1-3个月", count: counts.inceptionGap.m1_3, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "m1_3" }, "team") },
          { key: "m3_6", label: "3-6个月", count: counts.inceptionGap.m3_6, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "m3_6" }, "team") },
          { key: "m6_12", label: "6-12个月", count: counts.inceptionGap.m6_12, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "m6_12" }, "team") },
          { key: "over_y1", label: "1年以上", count: counts.inceptionGap.over_y1, href: dataListHref(scope, { inception_nav: "mismatch", inception_nav_gap: "over_y1" }, "team") },
        ]),
      },
    )
  }

  sections.push(
    {
      key: "nav_gap",
      title: "净值断档",
      hint: gapHint,
      rows: overviewRows(total, [
        { key: "interior", label: "中间缺失超1/10", count: counts.navGap.interior, href: gapHref ? dataListHref(scope, { nav_gap: "interior_2w" }, "both") : undefined },
        { key: "clear", label: "无中间缺失", count: counts.navGap.clear, href: gapHref ? dataListHref(scope, { nav_gap: "no_interior_2w" }, "both") : undefined },
        ...(counts.navGap.unchecked > 0 ? [{ key: "unchecked", label: "未检测", count: counts.navGap.unchecked }] : []),
      ]),
    },
    {
      key: "anomaly",
      title: "净值异常",
      hint: anomalyHint,
      rows: overviewRows(total, [
        { key: "jump", label: "有异常", count: counts.anomaly.jump, href: anomalyHref ? dataListHref(scope, { nav_anomaly: "jump" }, "both") : undefined },
        { key: "clear", label: "无异常", count: counts.anomaly.clear, href: anomalyHref ? dataListHref(scope, { nav_anomaly: "no_jump" }, "both") : undefined },
        ...(counts.anomaly.unchecked > 0 ? [{ key: "unchecked", label: "未检测", count: counts.anomaly.unchecked }] : []),
      ]),
    },
  )

  if (counts.anomaly.source + counts.anomaly.rules > 0) {
    sections.push({
      key: "anomaly_cause",
      title: "异常成因",
      hint: "只统计有异常的产品，与「异常成因」筛选一致。占比相对当前范围内的全部产品。",
      rows: overviewRows(total, [
        { key: "rules", label: "计算或修正导致", count: counts.anomaly.rules, href: anomalyHref ? dataListHref(scope, { nav_anomaly: "jump", nav_anomaly_cause: "rules" }, "both") : undefined },
        { key: "source", label: "源数据异常", count: counts.anomaly.source, href: anomalyHref ? dataListHref(scope, { nav_anomaly: "jump", nav_anomaly_cause: "source" }, "both") : undefined },
        ...(counts.anomaly.unknown > 0 ? [{ key: "unknown", label: "未能判断", count: counts.anomaly.unknown }] : []),
      ]),
    })
  }

  if (scope !== "platform") {
    const classRows = [
      { key: "private", label: "私募基金", count: counts.productClass.private, href: scope === "all" ? dataListHref("all", { product_class: "private", nav_presence: "all" }, "platform") : undefined },
      { key: "equity", label: "股权", count: counts.productClass.equity },
      { key: "trust", label: "信托", count: counts.productClass.trust },
      { key: "asset", label: "资管", count: counts.productClass.asset },
      ...(counts.productClass.unknown > 0 ? [{ key: "unknown", label: "未入库", count: counts.productClass.unknown }] : []),
    ].filter((row) => row.key === "private" || row.count > 0)
    sections.push({
      key: "product_class",
      title: "产品分类",
      hint: "与平台数据「产品分类」使用同一划分。股权、信托、资管之外计入私募基金。",
      rows: overviewRows(total, classRows),
    })
  }

  return sections
}

function responseFor(scope: DataOverviewScope, counts: OverviewCounts): DataOverviewResponse {
  const meta = SCOPE_META[scope]
  return {
    scope,
    scope_label: meta.label,
    description: meta.description,
    total: counts.total,
    generated_at: new Date().toISOString(),
    sections: sectionsFor(scope, counts),
  }
}

const SHARED_CTES = `
today AS (
  SELECT (timezone('Asia/Shanghai', now()))::date AS d
),
team_nav AS (
  SELECT code, MAX(d) AS d
  FROM (
    SELECT UPPER(BTRIM(product_code)) AS code, nav_date::date AS d
    FROM ops_email_nav_records
    WHERE nav IS NOT NULL AND nav_date IS NOT NULL AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), nav_date::date
    FROM ops_team_nav_manual
    WHERE unit_nav IS NOT NULL
      AND nav_date IS NOT NULL
      AND nav_type = 'pre_fee'
      AND nav_date > DATE '1970-01-01'
  ) s
  WHERE code <> ''
  GROUP BY code
),
channels AS (
  SELECT code, channel, MAX(d) AS d
  FROM (
    SELECT UPPER(BTRIM(product_code)) AS code, 'email'::text AS channel, nav_date::date AS d
    FROM ops_email_nav_records
    WHERE nav IS NOT NULL AND nav_date IS NOT NULL AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(product_code)),
      CASE
        WHEN COALESCE(source, '') = 'manual_upload' OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
        THEN 'manual' ELSE 'email'
      END,
      valuation_date::date
    FROM ops_email_valuation_records
    WHERE valuation_date IS NOT NULL AND valuation_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), 'manual', nav_date::date
    FROM ops_team_nav_manual
    WHERE unit_nav IS NOT NULL
      AND nav_date IS NOT NULL
      AND nav_type = 'pre_fee'
      AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(reg_code)), 'fof99', price_date::date
    FROM fof99_nav_fetch_log
    WHERE status = 'ok' AND price_date > DATE '1970-01-01'
  ) s
  WHERE code <> '' AND d IS NOT NULL
  GROUP BY code, channel
),
best_channel AS (
  SELECT DISTINCT ON (code) code, channel, d
  FROM channels
  ORDER BY code, d DESC, CASE channel WHEN 'manual' THEN 3 WHEN 'email' THEN 2 ELSE 1 END DESC
),
pool AS (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
),
val AS (
  SELECT DISTINCT UPPER(BTRIM(product_code)) AS code
  FROM ops_email_valuation_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
),
elem AS (
  SELECT DISTINCT UPPER(BTRIM(code)) AS code
  FROM (
    SELECT register_number AS code
    FROM basicinfo_bfl_track
    WHERE mandator_name IS NOT NULL
       OR open_day IS NOT NULL
       OR fee_manage_rate IS NOT NULL
       OR fee_trust IS NOT NULL
       OR fee_purchase IS NOT NULL
       OR fee_redeem IS NOT NULL
       OR closed_period IS NOT NULL
       OR precautious_line IS NOT NULL
       OR stop_line IS NOT NULL
       OR NULLIF(BTRIM(fee_manage), '') IS NOT NULL
       OR NULLIF(BTRIM(fee_admin_service), '') IS NOT NULL
       OR NULLIF(BTRIM(fee_pay), '') IS NOT NULL
    UNION ALL
    SELECT record_key
    FROM basicinfo_bfl_track
    WHERE mandator_name IS NOT NULL
       OR open_day IS NOT NULL
       OR fee_manage_rate IS NOT NULL
       OR fee_trust IS NOT NULL
       OR fee_purchase IS NOT NULL
       OR fee_redeem IS NOT NULL
       OR closed_period IS NOT NULL
       OR precautious_line IS NOT NULL
       OR stop_line IS NOT NULL
       OR NULLIF(BTRIM(fee_manage), '') IS NOT NULL
       OR NULLIF(BTRIM(fee_admin_service), '') IS NOT NULL
       OR NULLIF(BTRIM(fee_pay), '') IS NOT NULL
  ) s
  WHERE NULLIF(BTRIM(code), '') IS NOT NULL
),
op AS (
  SELECT DISTINCT UPPER(BTRIM(code)) AS code
  FROM unnest($1::text[]) AS t(code)
  WHERE NULLIF(BTRIM(code), '') IS NOT NULL
),
flags AS (
  SELECT DISTINCT ON (code)
    UPPER(BTRIM(beian_hao)) AS code,
    has_interior_gap,
    anomaly
  FROM ops_nav_series_flags
  WHERE rule_version = '${NAV_SERIES_FLAG_RULE}'
    AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
  ORDER BY code, computed_at DESC
)`

const COUNTS_SELECT = `
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE p.code IS NOT NULL)::int AS in_pool,
  COUNT(*) FILTER (WHERE bc.channel = 'email')::int AS email_n,
  COUNT(*) FILTER (WHERE bc.channel = 'manual')::int AS manual_n,
  COUNT(*) FILTER (WHERE bc.channel = 'fof99')::int AS fof99_n,
  COUNT(*) FILTER (WHERE bc.channel IS NULL)::int AS update_none,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) >= t.d - 7)::int AS nav_w0,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - 7 AND GREATEST(tn.d, u.nav_date) >= t.d - 14)::int AS nav_w1,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - 14 AND GREATEST(tn.d, u.nav_date) >= t.d - 21)::int AS nav_w2,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - 21 AND GREATEST(tn.d, u.nav_date) >= t.d - 28)::int AS nav_w3,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - 28 AND GREATEST(tn.d, u.nav_date) >= t.d - INTERVAL '3 months')::int AS nav_m1_3,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - INTERVAL '3 months' AND GREATEST(tn.d, u.nav_date) >= t.d - INTERVAL '6 months')::int AS nav_m3_6,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - INTERVAL '6 months')::int AS nav_over_m6,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NULL)::int AS nav_none,
  COUNT(*) FILTER (WHERE tn.d IS NOT NULL OR u.has_nav OR u.nav_date IS NOT NULL)::int AS nav_present,
  COUNT(*) FILTER (WHERE tn.d IS NULL AND NOT u.has_nav AND u.nav_date IS NULL)::int AS nav_absent,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) >= t.d - INTERVAL '1 month')::int AS date_m1,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) >= t.d - INTERVAL '3 months' AND GREATEST(tn.d, u.nav_date) < t.d - INTERVAL '1 month')::int AS date_m1_3,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) >= t.d - INTERVAL '6 months' AND GREATEST(tn.d, u.nav_date) < t.d - INTERVAL '3 months')::int AS date_m3_6,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NOT NULL AND GREATEST(tn.d, u.nav_date) < t.d - INTERVAL '6 months')::int AS date_over_m6,
  COUNT(*) FILTER (WHERE GREATEST(tn.d, u.nav_date) IS NULL)::int AS date_none,
  COUNT(*) FILTER (WHERE u.has_elements)::int AS elements_present,
  COUNT(*) FILTER (WHERE NOT u.has_elements)::int AS elements_missing,
  COUNT(*) FILTER (WHERE u.has_operation)::int AS operation_present,
  COUNT(*) FILTER (WHERE NOT u.has_operation)::int AS operation_absent,
  COUNT(*) FILTER (WHERE v.code IS NOT NULL)::int AS valuation_present,
  COUNT(*) FILTER (WHERE v.code IS NULL)::int AS valuation_absent,
  COUNT(*) FILTER (WHERE u.product_class = 'private')::int AS class_private,
  COUNT(*) FILTER (WHERE u.product_class = 'equity')::int AS class_equity,
  COUNT(*) FILTER (WHERE u.product_class = 'trust')::int AS class_trust,
  COUNT(*) FILTER (WHERE u.product_class = 'asset')::int AS class_asset,
  COUNT(*) FILTER (WHERE u.product_class = 'unknown')::int AS class_unknown,
  COUNT(*) FILTER (WHERE f.code IS NOT NULL AND f.has_interior_gap)::int AS gap_yes,
  COUNT(*) FILTER (WHERE f.code IS NOT NULL AND NOT f.has_interior_gap)::int AS gap_no,
  COUNT(*) FILTER (WHERE f.code IS NULL)::int AS gap_unchecked,
  COUNT(*) FILTER (WHERE f.code IS NOT NULL AND f.anomaly IS NOT NULL)::int AS anomaly_yes,
  COUNT(*) FILTER (WHERE f.code IS NOT NULL AND f.anomaly IS NULL)::int AS anomaly_no,
  COUNT(*) FILTER (WHERE f.code IS NULL)::int AS anomaly_unchecked,
  COUNT(*) FILTER (WHERE f.anomaly->>'cause' = 'source')::int AS cause_source,
  COUNT(*) FILTER (WHERE f.anomaly->>'cause' = 'rules')::int AS cause_rules
FROM universe u
CROSS JOIN today t
LEFT JOIN team_nav tn ON tn.code = u.code
LEFT JOIN best_channel bc ON bc.code = u.code
LEFT JOIN pool p ON p.code = u.code
LEFT JOIN val v ON v.code = u.code
LEFT JOIN flags f ON f.code = u.code`

function libraryUniverse(scope: "all" | "platform"): string {
  const where = scope === "platform" ? `WHERE ${PLATFORM_PRIVATE_CLASS_SQL}` : ""
  return `
universe AS (
  SELECT
    UPPER(BTRIM(i.beian_hao)) AS code,
    (i.latest_nav IS NOT NULL) AS has_nav,
    i.latest_nav_date::date AS nav_date,
    ${PLATFORM_PRODUCT_CLASS_CASE_SQL} AS product_class,
    (e.code IS NOT NULL) AS has_elements,
    (o.code IS NOT NULL) AS has_operation
  FROM private_fund_info i
  LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
  LEFT JOIN elem e ON e.code = UPPER(BTRIM(i.beian_hao))
  LEFT JOIN op o ON o.code = UPPER(BTRIM(i.beian_hao))
  ${where}
)`
}

const TRACKING_UNIVERSE = `
library AS (
  SELECT DISTINCT ON (code)
    code,
    has_nav,
    nav_date,
    product_class
  FROM (
    SELECT
      UPPER(BTRIM(i.beian_hao)) AS code,
      (i.latest_nav IS NOT NULL) AS has_nav,
      i.latest_nav_date::date AS nav_date,
      ${PLATFORM_PRODUCT_CLASS_CASE_SQL} AS product_class,
      i.latest_nav_date AS sort_date
    FROM private_fund_info i
    JOIN pool p ON p.code = UPPER(BTRIM(i.beian_hao))
    LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
  ) s
  ORDER BY code, has_nav DESC, sort_date DESC NULLS LAST
),
universe AS (
  SELECT
    p.code,
    COALESCE(lib.has_nav, false) AS has_nav,
    lib.nav_date,
    COALESCE(lib.product_class, 'unknown') AS product_class,
    (e.code IS NOT NULL) AS has_elements,
    (o.code IS NOT NULL) AS has_operation
  FROM pool p
  LEFT JOIN library lib ON lib.code = p.code
  LEFT JOIN elem e ON e.code = p.code
  LEFT JOIN op o ON o.code = p.code
)`

function statusSql(scope: "all" | "platform" | "tracking"): string {
  const universe = scope === "tracking" ? TRACKING_UNIVERSE : libraryUniverse(scope)
  return `WITH ${SHARED_CTES}, ${universe} ${COUNTS_SELECT}`
}

function countsFromSql(row: SqlCountRow | undefined): OverviewCounts {
  const blankWeek = emptyWeekCounts()
  if (!row) {
    return {
      total: 0,
      inPool: 0,
      update: { email: 0, manual: 0, fof99: 0, other: 0 },
      navFreshness: blankWeek,
      navPresence: { present: 0, absent: 0 },
      navDate: { m1: 0, m1_3: 0, m3_6: 0, over_m6: 0, none: 0 },
      elements: { present: 0, missing: 0 },
      operationDate: { present: 0, absent: 0 },
      valuation: { present: 0, absent: 0 },
      inception: null,
      inceptionGap: null,
      navGap: { interior: 0, clear: 0, unchecked: 0 },
      anomaly: { jump: 0, clear: 0, unchecked: 0, source: 0, rules: 0, unknown: 0 },
      productClass: { private: 0, equity: 0, trust: 0, asset: 0, unknown: 0 },
      seriesLive: false,
    }
  }
  return {
    total: n(row.total),
    inPool: n(row.in_pool),
    update: { email: n(row.email_n), manual: n(row.manual_n), fof99: n(row.fof99_n), other: n(row.update_none) },
    navFreshness: {
      w0: n(row.nav_w0),
      w1: n(row.nav_w1),
      w2: n(row.nav_w2),
      w3: n(row.nav_w3),
      m1_3: n(row.nav_m1_3),
      m3_6: n(row.nav_m3_6),
      over_m6: n(row.nav_over_m6),
      none: n(row.nav_none),
    },
    navPresence: { present: n(row.nav_present), absent: n(row.nav_absent) },
    navDate: {
      m1: n(row.date_m1),
      m1_3: n(row.date_m1_3),
      m3_6: n(row.date_m3_6),
      over_m6: n(row.date_over_m6),
      none: n(row.date_none),
    },
    elements: { present: n(row.elements_present), missing: n(row.elements_missing) },
    operationDate: { present: n(row.operation_present), absent: n(row.operation_absent) },
    valuation: { present: n(row.valuation_present), absent: n(row.valuation_absent) },
    inception: null,
    inceptionGap: null,
    navGap: { interior: n(row.gap_yes), clear: n(row.gap_no), unchecked: n(row.gap_unchecked) },
    anomaly: {
      jump: n(row.anomaly_yes),
      clear: n(row.anomaly_no),
      unchecked: n(row.anomaly_unchecked),
      source: n(row.cause_source),
      rules: n(row.cause_rules),
      unknown: Math.max(0, n(row.anomaly_yes) - n(row.cause_source) - n(row.cause_rules)),
    },
    productClass: {
      private: n(row.class_private),
      equity: n(row.class_equity),
      trust: n(row.class_trust),
      asset: n(row.class_asset),
      unknown: n(row.class_unknown),
    },
    seriesLive: false,
  }
}

async function queryScopeCounts(scope: "all" | "platform" | "tracking", opCodes: string[]): Promise<OverviewCounts> {
  const rows = await query<SqlCountRow>(statusSql(scope), [opCodes])
  return countsFromSql(rows[0])
}

type BeianAttr = {
  code: string
  has_nav: boolean
  nav_date: string | null
  product_class: string | null
  in_pool: boolean
  has_valuation: boolean
}

async function loadBeianAttrs(codes: string[]): Promise<Map<string, BeianAttr>> {
  const unique = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))]
  const out = new Map<string, BeianAttr>()
  if (unique.length === 0) return out
  const rows = await query<BeianAttr>(
    `WITH codes AS (
       SELECT DISTINCT UPPER(BTRIM(x)) AS code
       FROM unnest($1::text[]) AS t(x)
       WHERE NULLIF(BTRIM(x), '') IS NOT NULL
     ),
     library AS (
       SELECT DISTINCT ON (code)
         UPPER(BTRIM(i.beian_hao)) AS code,
         (i.latest_nav IS NOT NULL) AS has_nav,
         i.latest_nav_date::text AS nav_date,
         ${PLATFORM_PRODUCT_CLASS_CASE_SQL} AS product_class
       FROM private_fund_info i
       LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
       WHERE UPPER(BTRIM(i.beian_hao)) = ANY($1::text[])
       ORDER BY code, (i.latest_nav IS NOT NULL) DESC, i.latest_nav_date DESC NULLS LAST
     ),
     pool AS (
       SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
       FROM tracking_pool
       WHERE UPPER(BTRIM(register_number)) = ANY($1::text[])
     ),
     val AS (
       SELECT DISTINCT UPPER(BTRIM(product_code)) AS code
       FROM ops_email_valuation_records
       WHERE UPPER(BTRIM(product_code)) = ANY($1::text[])
     )
     SELECT
       c.code,
       COALESCE(l.has_nav, false) AS has_nav,
       l.nav_date,
       l.product_class,
       (p.code IS NOT NULL) AS in_pool,
       (v.code IS NOT NULL) AS has_valuation
     FROM codes c
     LEFT JOIN library l ON l.code = c.code
     LEFT JOIN pool p ON p.code = c.code
     LEFT JOIN val v ON v.code = c.code`,
    [unique],
  )
  for (const row of rows) out.set(row.code, row)
  return out
}

async function buildTeamOverview(): Promise<DataOverviewResponse> {
  try {
    const { ensureFofUnderlyingInEmailPool } = await import("@/lib/server/fof-email-product-sync")
    await ensureFofUnderlyingInEmailPool()
  } catch (err) {
    console.warn("[data-overview] FOF→邮箱池 sync skipped:", err)
  }
  const snapshot = await summarizeTeamDataStatus()
  const attrs = await loadBeianAttrs(snapshot.beians)
  const today = shanghaiToday()
  const navFreshness = emptyWeekCounts()
  const navPresence = { present: 0, absent: 0 }
  const navDate = { m1: 0, m1_3: 0, m3_6: 0, over_m6: 0, none: 0 }
  const valuation = { present: 0, absent: 0 }
  const productClass = { private: 0, equity: 0, trust: 0, asset: 0, unknown: 0 }
  let inPool = 0
  snapshot.beians.forEach((raw, index) => {
    const hit = attrs.get(raw.trim().toUpperCase())
    const union = laterNavDate(snapshot.navDates[index], hit?.nav_date)
    const hasNav = Boolean(union) || Boolean(hit?.has_nav)
    if (hasNav) navPresence.present += 1
    else navPresence.absent += 1
    navDate[navDateBucket(union, today)] += 1
    navFreshness[weekBucket(union, today)] += 1
    if (!hit) {
      valuation.absent += 1
      productClass.unknown += 1
      return
    }
    if (hit.in_pool) inPool += 1
    if (hit.has_valuation) valuation.present += 1
    else valuation.absent += 1
    if (hit.product_class === "private" || hit.product_class === "equity" || hit.product_class === "trust" || hit.product_class === "asset") {
      productClass[hit.product_class] += 1
    } else {
      productClass.unknown += 1
    }
  })
  return responseFor("team", {
    total: snapshot.total,
    inPool,
    update: snapshot.updateMethod,
    navFreshness,
    navPresence,
    navDate,
    elements: snapshot.elements,
    operationDate: snapshot.operationDate,
    valuation,
    inception: snapshot.inception,
    inceptionGap: snapshot.inceptionGap,
    navGap: { interior: snapshot.navGap.interior, clear: snapshot.navGap.clear, unchecked: 0 },
    anomaly: {
      jump: snapshot.anomaly.jump,
      clear: snapshot.anomaly.clear,
      unchecked: 0,
      source: snapshot.anomaly.source,
      rules: snapshot.anomaly.rules,
      unknown: snapshot.anomaly.unknown,
    },
    productClass,
    seriesLive: true,
  })
}

async function loadTrackingSeeds(): Promise<PlatformFundSeed[]> {
  const rows = await query<{ code: string; product_name: string }>(
    `SELECT DISTINCT ON (code)
       code,
       product_name
     FROM (
       SELECT UPPER(BTRIM(register_number)) AS code,
              COALESCE(NULLIF(BTRIM(product_name), ''), UPPER(BTRIM(register_number))) AS product_name
       FROM tracking_pool
       WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
     ) s
     ORDER BY code, product_name`,
  )
  return rows.map((row) => ({
    id: row.code,
    beian_hao: row.code,
    product_name: row.product_name,
    strategy_l1: null,
    strategy_l2: null,
    strategy_l3: null,
    first_entry_date: null,
  }))
}

async function applyLiveSeries(counts: OverviewCounts, seeds: PlatformFundSeed[]): Promise<void> {
  if (seeds.length === 0 || seeds.length > LIVE_SERIES_CAP || seeds.length !== counts.total) return
  const [assessed, alignment] = await Promise.all([
    assessPlatformNavSeries(seeds),
    loadInceptionNavAlignment(seeds),
  ])
  let interior = 0
  let jump = 0
  const inception = { match: 0, mismatch: 0, missing: 0 }
  const inceptionGap = emptyInceptionGapCounts()
  const anomalous: Array<{ id: string; beian_hao: string; product_name: string; nav_anomaly: NavAnomalyHit | null }> = []
  for (const seed of seeds) {
    if (assessed.gappedIds.has(seed.id)) interior += 1
    const hit = assessed.anomalyById.get(seed.id)
    if (hit) {
      jump += 1
      anomalous.push({
        id: seed.id,
        beian_hao: seed.beian_hao,
        product_name: seed.product_name,
        nav_anomaly: hit,
      })
    }
    const aligned = alignment.get(seed.id)
    const status = aligned?.status ?? "missing"
    inception[status] += 1
    if (status === "mismatch" && aligned) {
      const gaps: InceptionGapBucket[] = ["w2", "w2_m1", "m1_3", "m3_6", "m6_12", "over_y1"]
      for (const gap of gaps) {
        if (matchesInceptionNavGap(aligned.inception_date, aligned.nav_start_date, gap)) {
          inceptionGap[gap] += 1
          break
        }
      }
    }
  }
  const anomaly = { jump, clear: seeds.length - jump, unchecked: 0, source: 0, rules: 0, unknown: 0 }
  if (anomalous.length > 0) {
    const diagnosed = await attachNavAnomalyDiagnosis(anomalous)
    for (const row of diagnosed) {
      const cause = row.nav_anomaly?.cause
      if (cause === "source") anomaly.source += 1
      else if (cause === "rules") anomaly.rules += 1
      else anomaly.unknown += 1
    }
  }
  counts.navGap = { interior, clear: seeds.length - interior, unchecked: 0 }
  counts.anomaly = anomaly
  counts.inception = inception
  counts.inceptionGap = inceptionGap
  counts.seriesLive = true
}

async function buildCatalogOverview(scope: "all" | "platform" | "tracking"): Promise<DataOverviewResponse> {
  await loadFreshNavSeriesFlags([])
  const opCodes = await loadBeianCodesWithOperationDate()
  const [counts, seeds] = await Promise.all([
    queryScopeCounts(scope, opCodes),
    scope === "tracking" ? loadTrackingSeeds() : Promise.resolve([] as PlatformFundSeed[]),
  ])
  if (scope === "tracking") {
    try {
      await applyLiveSeries(counts, seeds)
    } catch (err) {
      console.error("[data-overview] tracking series scan failed:", err)
    }
  }
  return responseFor(scope, counts)
}

export async function buildDataOverview(scope: DataOverviewScope): Promise<DataOverviewResponse> {
  if (scope === "team") return buildTeamOverview()
  return buildCatalogOverview(scope)
}

export function parseDataOverviewScope(raw: string | null): DataOverviewScope {
  const value = (raw ?? "").trim().toLowerCase()
  if (value === "team" || value === "platform" || value === "tracking" || value === "all") return value
  return "all"
}

export async function getDataOverview(scope: DataOverviewScope, refresh: boolean): Promise<DataOverviewResponse> {
  const key = `ops-data-overview:v2:${scope}`
  if (refresh) {
    const body = await buildDataOverview(scope)
    setListResponseCache(key, body)
    return body
  }
  return await withListResponseCache(key, () => buildDataOverview(scope)) as DataOverviewResponse
}

export const dataOverviewScopeOptions = DATA_OVERVIEW_SCOPES
