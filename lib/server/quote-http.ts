import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function curlBin() {
  return process.platform === "win32" ? "curl.exe" : "curl"
}

type CurlOptions = { timeoutSec?: number; attempts?: number }

async function curlRaw(url: string, referer: string, options?: CurlOptions): Promise<Buffer> {
  const timeoutSec = options?.timeoutSec ?? 20
  const attempts = options?.attempts ?? 3
  let last = "行情源请求失败"
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        curlBin(),
        ["--http1.1", "-sS", "-m", String(timeoutSec), "-H", `User-Agent: ${UA}`, "-H", `Referer: ${referer}`, url],
        { encoding: "buffer", maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      )
      return stdout as Buffer
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw new Error(last.includes("行情源") ? last : "行情源请求失败")
}

export async function curlJson(url: string, referer: string, options?: CurlOptions): Promise<unknown> {
  const buf = await curlRaw(url, referer, options)
  return JSON.parse(buf.toString("utf8"))
}

export async function curlGbk(url: string, referer: string, options?: CurlOptions): Promise<string> {
  const buf = await curlRaw(url, referer, options)
  return new TextDecoder("gbk").decode(buf)
}
