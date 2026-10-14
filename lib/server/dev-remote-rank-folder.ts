/**
 * Local Windows dev does not have the server knowledge-base disk.
 * Pull 外部私募业绩排行 into the local knowledge-base directory so preview,
 * original download, and Excel generation read the same files as production.
 */

import { spawn } from "child_process"
import { once } from "events"
import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises"
import path from "path"
import AdmZip from "adm-zip"
import { EXTERNAL_RANK_FOLDER } from "@/lib/ma/external-rank-week"
import { getKnowledgeBaseStorageRoot } from "@/lib/server/knowledge-base"

const REMOTE_KB = "/root/market_dashboard_storage/ai-knowledge-base"
const SSH_HOST = "root@8.154.33.143"
const STALE_MS = 10 * 60 * 1000

let inflight: Promise<void> | null = null

function keyPath(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "id_ed25519_server")
}

function stampPath(): string {
  return path.join(process.cwd(), ".tmp", "external-rank-dev-sync.json")
}

async function hasSpreadsheets(dir: string): Promise<boolean> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (await hasSpreadsheets(child)) return true
    } else if (/\.xlsx?$/i.test(entry.name)) {
      return true
    }
  }
  return false
}

async function stampIsFresh(): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(stampPath(), "utf8")) as { syncedAt?: number }
    return typeof raw.syncedAt === "number" && Date.now() - raw.syncedAt < STALE_MS
  } catch {
    return false
  }
}

function sshArgs(remoteCommand?: string): string[] {
  const args = [
    "-i", keyPath(),
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=20",
    "-o", "StrictHostKeyChecking=accept-new",
    SSH_HOST,
  ]
  if (remoteCommand) args.push(remoteCommand)
  return args
}

function spawnExit(command: string, args: string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on("data", (chunk) => out.push(chunk))
  child.stderr.on("data", (chunk) => err.push(chunk))
  if (stdin != null) {
    child.stdin.write(stdin)
    child.stdin.end()
  } else {
    child.stdin.end()
  }
  return once(child, "close").then(([code]) => ({
    code: typeof code === "number" ? code : null,
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
  }))
}

async function pullFromServer(localRoot: string): Promise<void> {
  const key = keyPath()
  try {
    await stat(key)
  } catch {
    throw new Error("本机没有 SSH 密钥，无法读取服务器上的外部私募业绩排行文件")
  }
  await mkdir(localRoot, { recursive: true })
  const remoteZip = "/tmp/external-rank-dev-sync.zip"
  const localZip = path.join(process.cwd(), ".tmp", "external-rank-dev-sync.zip")
  await mkdir(path.dirname(localZip), { recursive: true })
  const script = [
    "import os, zipfile",
    `root = ${JSON.stringify(REMOTE_KB)}`,
    `folder = ${JSON.stringify(EXTERNAL_RANK_FOLDER)}`,
    `out = ${JSON.stringify(remoteZip)}`,
    "base = os.path.join(root, folder)",
    "if not os.path.isdir(base):",
    "    raise SystemExit('missing folder')",
    "count = 0",
    "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:",
    "    for dirpath, _, files in os.walk(base):",
    "        for name in files:",
    "            if name.startswith('.'):",
    "                continue",
    "            full = os.path.join(dirpath, name)",
    "            rel = os.path.relpath(full, root).replace(os.sep, '/')",
    "            archive.write(full, rel)",
    "            count += 1",
    "print(count)",
    "",
  ].join("\n")
  const packed = await spawnExit("ssh", sshArgs("python3 -"), script)
  if (packed.code !== 0) {
    const detail = (packed.stderr || packed.stdout).trim().slice(0, 300)
    throw new Error(detail ? `无法从服务器同步外部私募业绩排行：${detail}` : "无法从服务器同步外部私募业绩排行")
  }
  const copied = await spawnExit("scp", [
    "-i", key,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=20",
    "-o", "StrictHostKeyChecking=accept-new",
    `${SSH_HOST}:${remoteZip}`,
    localZip,
  ])
  await spawnExit("ssh", sshArgs(`rm -f ${remoteZip}`))
  if (copied.code !== 0) {
    const detail = copied.stderr.trim().slice(0, 300)
    throw new Error(detail ? `无法从服务器下载外部私募业绩排行：${detail}` : "无法从服务器下载外部私募业绩排行")
  }
  const zip = new AdmZip(localZip)
  zip.extractAllTo(localRoot, true)
}

async function syncOnce(): Promise<void> {
  const root = getKnowledgeBaseStorageRoot()
  const dest = path.join(root, EXTERNAL_RANK_FOLDER)
  if (await stampIsFresh() && await hasSpreadsheets(dest)) return
  await pullFromServer(root)
  if (!(await hasSpreadsheets(dest))) {
    throw new Error(`服务器知识库里没有「${EXTERNAL_RANK_FOLDER}」表格`)
  }
  await mkdir(path.dirname(stampPath()), { recursive: true })
  await writeFile(stampPath(), JSON.stringify({ syncedAt: Date.now() }))
}

/** Copy the server ranking folder into the local knowledge base. No-op off Windows. */
export function ensureDevRemoteRankFolder(): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve()
  if (!inflight) {
    inflight = syncOnce().finally(() => {
      inflight = null
    })
  }
  return inflight
}
