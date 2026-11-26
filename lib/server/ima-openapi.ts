/**
 * Thin client for the ima OpenAPI (ima.qq.com).
 * Credentials come from the environment, then ima_api/api_key.txt, then the
 * server storage file. The key is only sent to ima.qq.com.
 */

import { readFile } from "fs/promises"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

const BASE_URL = "https://ima.qq.com"

export type ImaCredentials = {
  clientId: string
  apiKey: string
}

type ImaEnvelope<T> = {
  code?: number
  msg?: string
  data?: T
}

function parseCredentialText(text: string): ImaCredentials | null {
  const clientId = (text.match(/Client ID:\s*(\S+)/) || [])[1]
  const apiKey = (text.match(/API Key:\s*(\S+)/) || [])[1]
  if (!clientId || !apiKey) return null
  return { clientId, apiKey }
}

async function readCredentialFile(filePath: string): Promise<ImaCredentials | null> {
  try {
    return parseCredentialText(await readFile(filePath, "utf8"))
  } catch {
    return null
  }
}

export async function loadImaCredentials(): Promise<ImaCredentials> {
  const envClient = process.env.IMA_OPENAPI_CLIENTID || process.env.IMA_CLIENT_ID || ""
  const envKey = process.env.IMA_OPENAPI_APIKEY || process.env.IMA_API_KEY || ""
  if (envClient && envKey) return { clientId: envClient, apiKey: envKey }

  const candidates = [
    path.join(process.cwd(), "ima_api", "api_key.txt"),
    getServerStoragePath("ima", "api_key.txt"),
  ]
  for (const filePath of candidates) {
    const found = await readCredentialFile(filePath)
    if (found) return found
  }
  throw new Error("未找到 ima 凭证。请配置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY，或放置 ima_api/api_key.txt。")
}

export async function imaPost<T>(apiPath: string, body: unknown, credentials?: ImaCredentials): Promise<T> {
  const creds = credentials || (await loadImaCredentials())
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/${apiPath}`, {
      method: "POST",
      headers: {
        "ima-openapi-clientid": creds.clientId,
        "ima-openapi-apikey": creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`ima 接口连不上：${message}`)
  }
  const text = await response.text()
  let json: ImaEnvelope<T>
  try {
    json = JSON.parse(text) as ImaEnvelope<T>
  } catch {
    throw new Error(`ima 接口返回的不是 JSON（HTTP ${response.status}）`)
  }
  if (!response.ok || json.code !== 0) {
    const err = new Error(json.msg || `ima 接口失败（HTTP ${response.status}）`) as Error & { imaCode?: number }
    if (typeof json.code === "number") err.imaCode = json.code
    if (response.status === 429) err.imaCode = err.imaCode ?? 110021
    throw err
  }
  return (json.data ?? {}) as T
}

export function isImaRateLimit(err: unknown): boolean {
  const code = err && typeof err === "object" && "imaCode" in err ? Number((err as { imaCode?: number }).imaCode) : NaN
  if (code === 110021 || code === 20002) return true
  const message = err instanceof Error ? err.message : String(err || "")
  return /频控|限频|rate limit/i.test(message)
}

/** Daily original-file quota. More calls the same day fail the same way. */
export function isImaDailyFetchCap(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "")
  return message.includes("资料获取次数已达上限")
}
