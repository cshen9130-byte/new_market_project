export type EnvelopeAddress = {
  name?: string
  address?: string
  mailbox?: string
  host?: string
}

export type EnvelopeRecipients = {
  from?: EnvelopeAddress[]
  to?: EnvelopeAddress[]
  cc?: EnvelopeAddress[]
  bcc?: EnvelopeAddress[]
}

function formatOne(addr: EnvelopeAddress | undefined): string {
  if (!addr) return ""
  if (addr.address?.trim()) return addr.address.trim().toLowerCase()
  if (addr.mailbox && addr.host) return `${addr.mailbox}@${addr.host}`.trim().toLowerCase()
  return ""
}

export function formatEnvelopeAddressList(list: EnvelopeAddress[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list ?? []) {
    const addr = formatOne(item)
    if (!addr || seen.has(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out
}

export function formatSenderEmail(from: EnvelopeAddress[] | undefined): string {
  return formatOne(from?.[0])
}

/** To + Cc + Bcc, de-duplicated, comma-separated, lowercased. */
export function formatReceiverEmail(envelope: EnvelopeRecipients | undefined): string {
  const addrs = [
    ...formatEnvelopeAddressList(envelope?.to),
    ...formatEnvelopeAddressList(envelope?.cc),
    ...formatEnvelopeAddressList(envelope?.bcc),
  ]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const addr of addrs) {
    if (seen.has(addr)) continue
    seen.add(addr)
    unique.push(addr)
  }
  return unique.join(", ")
}
