/**
 * JSON file-backed chat history store.
 * No native dependencies — works on any Node version (Node 18+).
 * Files are stored outside the project directory so they survive deployments.
 *
 * Storage layout:
 *   {storageDir}/chat_history/conversations.json   — all conversations array
 *   {storageDir}/chat_history/messages/{id}.json   — messages for one conversation
 */
import { randomUUID } from "crypto"
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatConversation = {
  id: string
  userId: string
  title: string
  scope: string        // folder path OR file relativePath
  scopeType: "folder" | "file"
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  id: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  sources: string[]   // file paths cited by the assistant
  createdAt: string
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageDir(): string {
  return getServerStoragePath("chat_history")
}

function convsFile(): string {
  return path.join(storageDir(), "conversations.json")
}

function msgsFile(conversationId: string): string {
  return path.join(storageDir(), "messages", `${conversationId}.json`)
}

function readConversations(): ChatConversation[] {
  mkdirSync(storageDir(), { recursive: true })
  const file = convsFile()
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return [] }
}

function writeConversations(convs: ChatConversation[]): void {
  mkdirSync(storageDir(), { recursive: true })
  writeFileSync(convsFile(), JSON.stringify(convs, null, 2))
}

function readMessages(conversationId: string): ChatMessage[] {
  const file = msgsFile(conversationId)
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return [] }
}

function writeMessages(conversationId: string, messages: ChatMessage[]): void {
  const dir = path.join(storageDir(), "messages")
  mkdirSync(dir, { recursive: true })
  writeFileSync(msgsFile(conversationId), JSON.stringify(messages, null, 2))
}

// ── Conversations ─────────────────────────────────────────────────────────────

export function listConversations(userId: string): ChatConversation[] {
  return readConversations()
    .filter(c => c.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 100)
}

export function getConversation(id: string, userId: string): ChatConversation | null {
  return readConversations().find(c => c.id === id && c.userId === userId) ?? null
}

export function createConversation(
  userId: string,
  title: string,
  scope: string,
  scopeType: "folder" | "file",
): ChatConversation {
  const id = randomUUID()
  const now = new Date().toISOString()
  const conv: ChatConversation = { id, userId, title, scope, scopeType, createdAt: now, updatedAt: now }
  const convs = readConversations()
  convs.push(conv)
  writeConversations(convs)
  return conv
}

export function updateConversationTitle(id: string, userId: string, title: string): void {
  const convs = readConversations()
  const conv = convs.find(c => c.id === id && c.userId === userId)
  if (conv) {
    conv.title = title
    conv.updatedAt = new Date().toISOString()
    writeConversations(convs)
  }
}

export function touchConversation(id: string): void {
  const convs = readConversations()
  const conv = convs.find(c => c.id === id)
  if (conv) {
    conv.updatedAt = new Date().toISOString()
    writeConversations(convs)
  }
}

export function deleteConversation(id: string, userId: string): void {
  const convs = readConversations()
  const idx = convs.findIndex(c => c.id === id && c.userId === userId)
  if (idx !== -1) {
    convs.splice(idx, 1)
    writeConversations(convs)
    const file = msgsFile(id)
    if (existsSync(file)) { try { rmSync(file) } catch { /* ignore */ } }
  }
}

export function countMessages(conversationId: string): number {
  return readMessages(conversationId).length
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function getMessages(conversationId: string, userId: string): ChatMessage[] {
  const conv = readConversations().find(c => c.id === conversationId && c.userId === userId)
  if (!conv) return []
  return readMessages(conversationId)
}

export function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  sources: string[] = [],
): ChatMessage {
  const id = randomUUID()
  const now = new Date().toISOString()
  const message: ChatMessage = { id, conversationId, role, content, sources, createdAt: now }
  const messages = readMessages(conversationId)
  messages.push(message)
  writeMessages(conversationId, messages)
  touchConversation(conversationId)
  return message
}
