/**
 * ImapFlow helpers that prevent async socket errors from crashing the process.
 *
 * Without an `error` listener, late `socketTimeout` / ETIMEOUT events become
 * unhandled 'error' emissions and kill the whole Node process (seen in the
 * background worker when IMAP overlaps CPU-heavy cache jobs).
 */
import { ImapFlow } from "imapflow"

type ImapFlowConstructorOptions = ConstructorParameters<typeof ImapFlow>[0]

export type CreateSafeImapFlowOptions = ImapFlowConstructorOptions & {
  /** Optional label for log lines (e.g. mailbox address). */
  label?: string
}

export function createSafeImapFlow(options: CreateSafeImapFlowOptions): ImapFlow {
  const { label, ...imapOptions } = options
  const client = new ImapFlow(imapOptions)
  const tag = label ? `imap:${label}` : "imap"

  client.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[${tag}] connection error (suppressed): ${msg}`)
  })

  return client
}

/** Logout if possible, otherwise force-close. Never throws. */
export async function closeImapFlow(
  client: ImapFlow | null | undefined,
  opts?: { force?: boolean },
): Promise<void> {
  if (!client) return
  try {
    if (opts?.force) {
      await client.close()
    } else {
      await client.logout()
    }
  } catch {
    try {
      await client.close()
    } catch {
      // ignore
    }
  }
}
