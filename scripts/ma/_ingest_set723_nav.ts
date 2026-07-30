/**
 * Ingest 墨雪顺遂二号 (SET723) historical 产品净值 attachment into ops_email_nav_records
 * and refresh the detail NAV cache.
 *
 * Usage: npx tsx scripts/ma/_ingest_set723_nav.ts
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const fs = await import("fs")
  const path = await import("path")
  const { ImapFlow } = await import("imapflow")
  const { extractNavTableFromBuffer } = await import("../../lib/server/email-nav-attachment")
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg")
  const { loadEmailNavSeries } = await import("../../lib/server/email-nav-query")
  const {
    invalidateDetailNavCache,
    refreshDetailNavCacheForFund,
  } = await import("../../lib/server/fund-detail-nav-cache-pg")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const { query } = await import("../../lib/db")

  const accounts = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/ops_crawl_emails.json"), "utf8"),
  ) as Array<{ account: string; pass: string; imapHost: string; imapPort: number }>
  const account = accounts.find((a) => a.account === "data@jinyuasset.com")
  if (!account) throw new Error("data@jinyuasset.com not in crawl emails")

  const uid = "903"
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock("INBOX")
  let buffer: Buffer
  let subject: string
  let senderEmail: string
  let sentAt: string
  const filename = "墨雪顺遂二号私募证券投资基金_产品净值20260730113527.xlsx"
  try {
    const msg = await client.fetchOne(uid, { uid: true, envelope: true, bodyStructure: true }, { uid: true })
    if (!msg) throw new Error("UID 903 not found")
    subject = String(msg.envelope?.subject ?? "")
    senderEmail = String(msg.envelope?.from?.[0]?.address ?? "")
    sentAt = (msg.envelope?.date ? new Date(msg.envelope.date) : new Date()).toISOString()
    const dl = await client.download(uid, "2", { uid: true })
    const bufs: Buffer[] = []
    for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
    buffer = Buffer.concat(bufs)
    fs.writeFileSync(path.join(process.cwd(), "tmp_set723_nav.xlsx"), buffer)
  } finally {
    lock.release()
    await client.logout()
  }

  const extracted = extractNavTableFromBuffer(buffer, filename, subject)
  console.log("extracted", extracted.length, extracted[0], extracted.at(-1))
  if (extracted.length < 100) {
    throw new Error(`expected full history, got ${extracted.length} rows`)
  }

  const saved = await upsertEmailNavRecords(
    extracted.map((row) => ({
      crawlEmailAccount: "data@jinyuasset.com",
      emailUid: uid,
      sentAt,
      subject,
      senderEmail,
      navDate: row.navDate!,
      nav: row.nav,
      cumulativeNav: row.cumulativeNav,
      adjustedNav: row.adjustedNav,
      productCode: row.productCode ?? "SET723",
      fundName: row.fundName ?? "墨雪顺遂二号",
      source: row.source,
      attachmentFilename: filename,
    })),
  )
  console.log("upserted", saved)

  const n = await invalidateDetailNavCache(["SET723", "SBT723"])
  console.log("cache_invalidated", n)

  const ok = await refreshDetailNavCacheForFund({
    beian_hao: "SET723",
    product_name: "墨雪顺遂二号私募证券投资基金",
    short_name: "墨雪顺遂二号",
  })
  console.log("cache_refreshed", ok)

  const cache = await query(
    `SELECT tip_nav_date::text AS tip_nav_date, tip_unit_nav::text AS tip_unit_nav,
            jsonb_array_length(nav_series) AS n,
            nav_series->0 AS first,
            nav_series->-1 AS last
     FROM ops_private_fund_detail_nav_cache
     WHERE cache_key = 'SET723'`,
  )
  console.log("cache_row", JSON.stringify(cache, null, 2))

  const emailSeries = await loadEmailNavSeries(
    "SET723",
    "墨雪顺遂二号私募证券投资基金",
    "墨雪顺遂二号",
  )
  console.log("email_series", {
    n: emailSeries.length,
    first: emailSeries[0],
    last: emailSeries.at(-1),
  })

  const merged = await loadMergedFundNavRows(
    "SET723",
    "墨雪顺遂二号私募证券投资基金",
    "墨雪顺遂二号",
  )
  console.log("merged", {
    n: merged.length,
    first: merged[0],
    last: merged.at(-1),
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
