import { ImapFlow } from "imapflow"
import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"

const DATA_FILE = path.join(process.cwd(), "data", "ops_crawl_emails.json")
const WANT = new Set([
  "衡颐承和FOF1号私募证券投资基金",
  "衡颐海泰1号私募证券投资基金",
  "上海荣熙私募基金管理有限公司－荣熙共赢私募证券投资基金",
  "荣熙共赢私募证券投资基金",
  "抱朴聚融祥和一号私募证券投资基金",
])

const rows = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"))
const account = rows[0]
const client = new ImapFlow({
  host: account.imapHost,
  port: account.imapPort || 993,
  secure: true,
  auth: { user: account.account, pass: account.pass },
  logger: false,
})

function parseVirtualFeeSubject(subject) {
  const m = subject.match(/^虚拟业绩报酬_(.+?)_[A-Z0-9]+_.+_\d{4}-\d{2}-\d{2}/u)
  return m?.[1]?.trim() ?? ""
}

function parseEstimateSubject(subject) {
  const m = subject.match(/【基金虚拟净值表现估算】[^_]+_.+_\d{4}-\d{2}-\d{2}_(.+)$/u)
  return m?.[1]?.trim() ?? ""
}

function scanXlsx(buf) {
  const accounts = []
  try {
    const wb = XLSX.read(buf, { type: "buffer" })
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" })
      for (const row of rows) {
        for (const cell of row) {
          const s = String(cell).trim().toUpperCase()
          if (/^S\d{11}$/.test(s) || /^[A-Z]{1,2}\d{10,14}$/.test(s)) accounts.push(s)
        }
      }
    }
  } catch {}
  return [...new Set(accounts)]
}

function collectAttachments(node, pathStr = "", out = []) {
  const fname = node.dispositionParameters?.filename ?? node.parameters?.name ?? ""
  const disp = (node.disposition ?? "").toLowerCase()
  if (fname && (disp === "attachment" || fname)) {
    const lower = fname.toLowerCase()
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) out.push({ part: pathStr || "1", filename: fname })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child, i) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

const found = new Map()
await client.connect()
await client.mailboxOpen("INBOX")
const since = new Date()
since.setDate(since.getDate() - 90)
const uids = (await client.search({ since })) || []

for (const uid of uids) {
  const envMsg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true })
  const subject = envMsg?.envelope?.subject ?? ""

  let customer = ""
  if (subject.includes("TA虚拟净值")) {
    const b = subject.match(/【([^】]+)】/u)
    const inner = b?.[1] ?? ""
    if (WANT.has(inner)) customer = inner
  } else {
    customer = parseVirtualFeeSubject(subject) || parseEstimateSubject(subject)
    if (!WANT.has(customer)) continue
  }

  if (!customer) continue

  const structure = envMsg?.bodyStructure
  const parts = structure ? collectAttachments(structure) : []
  let taAccount = ""
  for (const { part } of parts) {
    try {
      const dl = await client.download(String(uid), part)
      const bufs = []
      for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
      const accts = scanXlsx(Buffer.concat(bufs))
      if (accts.length) taAccount = accts[0]
    } catch {}
  }

  if (!taAccount && subject.includes("TA虚拟净值")) {
    // text body fallback handled by main parser
    continue
  }

  if (customer && taAccount && !found.has(customer)) {
    found.set(customer, { customer, taAccount, subject: subject.slice(0, 100) })
  }
}

console.log(JSON.stringify([...found.values()], null, 2))
await client.logout()
