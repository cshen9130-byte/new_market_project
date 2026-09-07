/**
 * Repair Citics 【基金净值】 rows that stored 累计单位净值 as 单位净值.
 *
 * Only targets funds that previously had a real unit/cum split, then collapsed
 * onto the 累计 scale (same pattern as GM266C / SVM387). Does not guess unit
 * from the previous close — re-downloads the IMAP UID and re-parses.
 *
 * Never writes: GM266C, SVM387, SYM387, SGN266, SBDF95, BDF95A, SET723,
 * SVP460, SAVW72, or any preserve_high_nav_scale correction-rule fund.
 *
 * Usage:
 *   npx tsx scripts/ma/_repair_citics_fund_nav_swap.ts
 *   npx tsx scripts/ma/_repair_citics_fund_nav_swap.ts --apply
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const ALREADY_FIXED = new Set(["GM266C", "SVM387", "SYM387", "SGN266"])
const ALWAYS_SKIP = new Set(["SBDF95", "BDF95A", "SET723", "SVP460", "SAVW72"])

type TargetRow = {
  id: string
  product_code: string
  fund_name: string | null
  nav_date: string
  nav: string
  cumulative_nav: string | null
  subject: string | null
  crawl_email_account: string
  email_uid: string
  attachment_filename: string | null
}

type ParsedNav = {
  nav: number
  cumulativeNav: number | null
  navDate: string
  productCode: string | null
  fundName: string | null
  source: string
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function near(a: number, b: number, eps = 0.00025): boolean {
  return Math.abs(a - b) < eps
}

function canon(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase()
}

function decodeFetchedImapPart(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf) return buf
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return buf
  const head = buf.subarray(0, Math.min(buf.length, 80)).toString("ascii").replace(/\s+/g, "")
  if (/^(?:UEsDB|JVBERi|0M8R4K)/.test(head)) {
    return Buffer.from(buf.toString("ascii").replace(/\s+/g, ""), "base64")
  }
  return buf
}

function collectAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: { filename: string; part: string }[] = [],
): { filename: string; part: string }[] {
  const fname: string =
    node.dispositionParameters?.filename
    ?? node.dispositionParameters?.name
    ?? node.parameters?.name
    ?? ""
  if (fname) out.push({ filename: fname, part: pathStr || "1" })
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function collectTextParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: { part: string; mime: string }[] = [],
): { part: string; mime: string }[] {
  const fname: string =
    node.dispositionParameters?.filename
    ?? node.dispositionParameters?.name
    ?? node.parameters?.name
    ?? ""
  const mime: string = (node.type ?? "").toLowerCase()
  const subtype: string = (node.subtype ?? "").toLowerCase()
  const fullMime = subtype ? `${mime}/${subtype}` : mime
  const disp: string = (node.disposition ?? "").toLowerCase()
  const isAttachment = disp === "attachment" || !!fname
  if (!isAttachment && (fullMime.includes("text/plain") || fullMime.includes("text/html"))) {
    out.push({ part: pathStr || "1", mime: fullMime })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectTextParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

function pickParsedForRow(row: TargetRow, parsed: ParsedNav[]): ParsedNav | null {
  const code = canon(row.product_code)
  const date = row.nav_date.slice(0, 10)
  const sameDate = parsed.filter((p) => p.navDate.slice(0, 10) === date)
  const byCode = sameDate.find((p) => canon(p.productCode) === code)
  if (byCode) return byCode
  const name = (row.fund_name ?? "").trim()
  if (name.length >= 4) {
    const byName = sameDate.find((p) => {
      const pn = (p.fundName ?? "").trim()
      return pn.length >= 4 && (pn.includes(name) || name.includes(pn))
    })
    if (byName) return byName
  }
  const split = sameDate.filter((p) => p.cumulativeNav != null && !near(p.nav, p.cumulativeNav))
  if (split.length === 1) return split[0] ?? null
  return null
}

function decideApply(row: TargetRow, parsed: ParsedNav): { ok: boolean; reason: string } {
  const storedNav = num(row.nav)
  const unit = parsed.nav
  const cum = parsed.cumulativeNav
  if (storedNav == null || !Number.isFinite(unit) || unit <= 0) {
    return { ok: false, reason: "missing unit" }
  }
  if (cum == null || !Number.isFinite(cum) || cum <= 0) {
    return { ok: false, reason: "missing parsed cum" }
  }
  if (near(unit, cum)) {
    return { ok: false, reason: "parsed still unit==cum" }
  }
  if (cum + 1e-6 < unit) {
    return { ok: false, reason: "parsed cum < unit" }
  }
  if (!near(cum, storedNav, 0.05)) {
    return { ok: false, reason: `parsed cum ${cum} != stored nav ${storedNav}` }
  }
  if (near(unit, storedNav, 0.002)) {
    return { ok: false, reason: "parsed unit already equals stored nav" }
  }
  return { ok: true, reason: "swap confirmed by reparse" }
}

async function main() {
  const apply = process.argv.includes("--apply")
  const { query } = await import("../../lib/db")
  const { lookupFundNavCorrectionRule } = await import("../../lib/server/fund-nav-correction-rules")
  const { getCrawlEmailByAccount, getImapFolders } = await import("../../lib/server/crawl-emails")
  const { createSafeImapFlow, closeImapFlow } = await import("../../lib/server/imap-flow-safe")
  const { extractCiticsFundNavAnnouncementRows } = await import("../../lib/server/email-nav-extract")
  const { extractNavTableFromBuffer, selectNavTableAttachments } = await import(
    "../../lib/server/email-nav-attachment"
  )
  const { invalidateDetailNavCache } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const firstSwaps = await query<{
    product_code: string
    fund_name: string | null
    first_swap_date: string
  }>(
    `WITH ranked AS (
       SELECT e.product_code, e.fund_name, e.nav_date, e.nav, e.cumulative_nav,
              LAG(e.nav) OVER (PARTITION BY UPPER(BTRIM(e.product_code)) ORDER BY e.nav_date, e.id) AS prev_nav,
              LAG(e.cumulative_nav) OVER (PARTITION BY UPPER(BTRIM(e.product_code)) ORDER BY e.nav_date, e.id) AS prev_cum
         FROM ops_email_nav_records e
        WHERE e.subject ILIKE '%【基金净值】%'
          AND e.source = 'attachment_nav_table'
          AND e.nav_date >= DATE '2026-06-01'
     )
     SELECT product_code, MAX(fund_name) AS fund_name, MIN(nav_date)::text AS first_swap_date
       FROM ranked
      WHERE ABS(nav - COALESCE(cumulative_nav, nav)) < 0.0002
        AND prev_nav IS NOT NULL
        AND prev_cum IS NOT NULL
        AND ABS(prev_nav - prev_cum) > 0.01
        AND ABS(nav - prev_cum) < 0.08
        AND ABS(nav - prev_nav) > 0.05
      GROUP BY product_code`,
  )

  const swapFunds: { code: string; name: string | null; firstSwapDate: string }[] = []
  for (const r of firstSwaps) {
    const code = canon(r.product_code)
    if (ALREADY_FIXED.has(code) || ALWAYS_SKIP.has(code)) {
      console.log(`skip fund ${code} (${ALREADY_FIXED.has(code) ? "already-fixed" : "hard-skip"})`)
      continue
    }
    const rule = lookupFundNavCorrectionRule(code, r.fund_name, null)
    if (rule?.preserve_high_nav_scale || (rule && ALWAYS_SKIP.has(canon(rule.beian_hao)))) {
      console.log(`skip fund ${code} (correction-rule ${rule.beian_hao})`)
      continue
    }
    swapFunds.push({ code, name: r.fund_name, firstSwapDate: r.first_swap_date })
  }

  console.log(`swap funds: ${swapFunds.map((f) => `${f.code}@${f.firstSwapDate}`).join(", ") || "(none)"}`)
  if (swapFunds.length === 0) {
    console.log("nothing to repair")
    return
  }

  const targets: TargetRow[] = []
  for (const fund of swapFunds) {
    const rows = await query<TargetRow>(
      `SELECT id::text, product_code, fund_name, nav_date::text, nav::text, cumulative_nav::text,
              subject, crawl_email_account, email_uid, attachment_filename
         FROM ops_email_nav_records
        WHERE UPPER(BTRIM(product_code)) = $1
          AND subject ILIKE '%【基金净值】%'
          AND source = 'attachment_nav_table'
          AND nav_date >= $2::date
          AND ABS(nav - COALESCE(cumulative_nav, nav)) < 0.0002
        ORDER BY nav_date, id`,
      [fund.code, fund.firstSwapDate],
    )
    targets.push(...rows)
  }

  console.log(`target rows: ${targets.length}`)
  for (const r of targets) {
    console.log(`  ${r.product_code} ${r.nav_date} nav=${r.nav} uid=${r.email_uid} ${r.fund_name ?? ""}`)
  }

  const byMailbox = new Map<string, Map<string, TargetRow[]>>()
  for (const row of targets) {
    let uids = byMailbox.get(row.crawl_email_account)
    if (!uids) {
      uids = new Map()
      byMailbox.set(row.crawl_email_account, uids)
    }
    const list = uids.get(row.email_uid) ?? []
    list.push(row)
    uids.set(row.email_uid, list)
  }

  const parsedByKey = new Map<string, ParsedNav[]>()
  const imapErrors: string[] = []

  for (const [acctName, uids] of byMailbox) {
    const account = await getCrawlEmailByAccount(acctName)
    if (!account?.pass?.trim()) {
      imapErrors.push(`${acctName}: mailbox not configured`)
      continue
    }
    const folders = getImapFolders(account)
    const client = createSafeImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.account, pass: account.pass },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 10_000,
      socketTimeout: 180_000,
      label: account.account,
    })
    await client.connect()
    try {
      for (const [uid, uidRows] of uids) {
        let found = false
        for (const folder of folders) {
          try {
            await client.mailboxOpen(folder)
          } catch (e) {
            imapErrors.push(`${acctName} ${folder}: ${e instanceof Error ? e.message : e}`)
            continue
          }
          const msg = await client.fetchOne(
            uid,
            { uid: true, envelope: true, bodyStructure: true, internalDate: true },
            { uid: true },
          )
          if (!msg) continue
          found = true
          const subject = msg.envelope?.subject ?? uidRows[0]?.subject ?? ""
          const attachments = collectAttachments(msg.bodyStructure)
          const textParts = collectTextParts(msg.bodyStructure)
          const selected = selectNavTableAttachments(subject, attachments)
          const parsed: ParsedNav[] = []

          if (textParts.length > 0) {
            const bodyMsg = await client.fetchOne(
              uid,
              { uid: true, bodyParts: textParts.map((p) => p.part) },
              { uid: true },
            )
            const bodyParts = (bodyMsg as { bodyParts?: Map<string, Buffer> }).bodyParts
            const texts: string[] = []
            for (const part of textParts) {
              const raw = bodyParts?.get(part.part) ?? bodyParts?.get(String(part.part))
              if (!raw?.length) continue
              let decoded = decodeFetchedImapPart(raw).toString("utf8")
              if (/=[0-9A-Fa-f]{2}/.test(decoded)) decoded = decodeQuotedPrintable(decoded)
              texts.push(part.mime.includes("html") ? stripHtml(decoded) : decoded)
            }
            for (const fromBody of extractCiticsFundNavAnnouncementRows(subject, texts.join("\n"))) {
              if (fromBody?.nav != null && fromBody.navDate) {
                parsed.push({
                  nav: fromBody.nav,
                  cumulativeNav: fromBody.cumulativeNav ?? null,
                  navDate: fromBody.navDate,
                  productCode: fromBody.productCode ?? null,
                  fundName: fromBody.fundName ?? null,
                  source: "body",
                })
              }
            }
          }

          if (selected.length > 0) {
            const attMsg = await client.fetchOne(
              uid,
              { uid: true, bodyParts: selected.map((a) => a.part) },
              { uid: true },
            )
            const bodyParts = (attMsg as { bodyParts?: Map<string, Buffer> }).bodyParts
            for (const att of selected) {
              let buf = bodyParts?.get(att.part) ?? bodyParts?.get(String(att.part)) ?? null
              if (!buf?.length) {
                const dl = await client.download(uid, att.part, { uid: true })
                const chunks: Buffer[] = []
                for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
                buf = Buffer.concat(chunks)
              }
              buf = decodeFetchedImapPart(buf)
              for (const r of extractNavTableFromBuffer(buf, att.filename, subject)) {
                if (!r.navDate || r.nav == null) continue
                parsed.push({
                  nav: r.nav,
                  cumulativeNav: r.cumulativeNav ?? null,
                  navDate: r.navDate,
                  productCode: r.productCode ?? null,
                  fundName: r.fundName ?? null,
                  source: `xlsx:${att.filename}`,
                })
              }
            }
          }

          parsedByKey.set(`${acctName}|${uid}`, parsed)
          console.log(
            `IMAP ${acctName} uid=${uid} folder=${folder} parsed=${parsed.length} ` +
              parsed
                .map((p) => `${p.productCode} ${p.navDate} unit=${p.nav} cum=${p.cumulativeNav} ${p.source}`)
                .join(" | "),
          )
          break
        }
        if (!found) imapErrors.push(`${acctName} uid=${uid}: not found in ${folders.join(",")}`)
      }
    } finally {
      await closeImapFlow(client)
    }
  }

  if (imapErrors.length > 0) {
    console.log("imap errors:")
    for (const e of imapErrors) console.log(`  ${e}`)
  }

  type Decision = { row: TargetRow; parsed: ParsedNav | null; reason: string; ok: boolean }
  const decisions: Decision[] = []
  for (const row of targets) {
    const parsedList = parsedByKey.get(`${row.crawl_email_account}|${row.email_uid}`) ?? []
    const picked = pickParsedForRow(row, parsedList)
    if (!picked) {
      decisions.push({ row, parsed: null, reason: "no parsed match", ok: false })
      continue
    }
    const verdict = decideApply(row, picked)
    decisions.push({ row, parsed: picked, reason: verdict.reason, ok: verdict.ok })
  }

  console.log("decisions:")
  for (const d of decisions) {
    const p = d.parsed
    console.log(
      `  ${d.ok ? "APPLY" : "HOLD"} ${d.row.product_code} ${d.row.nav_date} ` +
        `stored=${d.row.nav}/${d.row.cumulative_nav} -> ${p ? `${p.nav}/${p.cumulativeNav}` : "n/a"} ${d.reason}`,
    )
  }

  const toApply = decisions.filter((d) => d.ok && d.parsed)
  if (!apply) {
    console.log(`dry run; ${toApply.length} row(s) would be updated. pass --apply to write`)
    return
  }

  const cacheCodes = new Set<string>()
  let emailUpdated = 0
  let platformUpdated = 0
  for (const d of toApply) {
    const parsed = d.parsed
    if (!parsed) continue
    const code = canon(d.row.product_code)
    if (ALREADY_FIXED.has(code) || ALWAYS_SKIP.has(code)) {
      console.log(`  refuse write ${code}`)
      continue
    }
    const storedNav = num(d.row.nav)
    const upd = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE ops_email_nav_records
            SET nav = $1,
                cumulative_nav = $2
          WHERE id = $3::bigint
            AND ABS(nav - COALESCE(cumulative_nav, nav)) < 0.0002
            AND ABS(nav - $4) < 0.002
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
      [parsed.nav, parsed.cumulativeNav, d.row.id, storedNav],
    )
    emailUpdated += parseInt(upd[0]?.n ?? "0", 10)

    const plat = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE private_fund_nav
            SET nav = $1,
                cumulative_nav = $2
          WHERE UPPER(BTRIM(beian_hao)) = $3
            AND price_date = $4::date
            AND ABS(nav - COALESCE(cumulative_nav, nav)) < 0.0002
            AND ABS(nav - $5) < 0.002
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
      [parsed.nav, parsed.cumulativeNav, code, d.row.nav_date, storedNav],
    )
    platformUpdated += parseInt(plat[0]?.n ?? "0", 10)
    cacheCodes.add(code)
    if (parsed.productCode) cacheCodes.add(canon(parsed.productCode))
  }

  const cleared = await invalidateDetailNavCache([...cacheCodes])
  console.log(`email updated: ${emailUpdated}`)
  console.log(`platform updated: ${platformUpdated}`)
  console.log(`detail cache cleared: ${cleared} keys=${[...cacheCodes].join(",")}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
