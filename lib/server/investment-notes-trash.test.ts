/**
 *   npx tsx --test lib/server/investment-notes-trash.test.ts
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import {
  investmentNoteTrashDaysLeft,
  INVESTMENT_NOTE_TRASH_RETENTION_DAYS,
} from "../ma/investment-notes"
import {
  createServerInvestmentNote,
  deleteServerInvestmentNote,
  emptyServerInvestmentNoteTrash,
  listServerInvestmentNotes,
  listServerTrashedInvestmentNotes,
  purgeServerInvestmentNote,
  restoreServerInvestmentNote,
} from "./investment-notes"

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "investment-notes-trash-"))
process.env.MARKET_DASHBOARD_STORAGE_DIR = tmpRoot

const USER_A = "user-a"
const USER_B = "user-b"

describe("investmentNoteTrashDaysLeft", () => {
  it("returns remaining whole days until expiry", () => {
    const now = Date.parse("2026-09-17T06:00:00.000Z")
    const deletedAt = "2026-09-10T06:00:00.000Z"
    assert.equal(investmentNoteTrashDaysLeft(deletedAt, now), 23)
  })

  it("is 0 after the retention window", () => {
    const now = Date.parse("2026-10-20T00:00:00.000Z")
    assert.equal(investmentNoteTrashDaysLeft("2026-09-01T00:00:00.000Z", now), 0)
  })
})

describe("投资笔记 回收站", () => {
  it("moves a deleted note to trash instead of destroying it", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "嘉策百煅手工T0",
      content: "<p>线下尽调</p>",
      teamShared: false,
    })
    assert.equal(deleteServerInvestmentNote(note.id, USER_A, "G.Wave"), true)
    assert.equal(listServerInvestmentNotes("mine", USER_A).some((n) => n.id === note.id), false)
    const trash = listServerTrashedInvestmentNotes(USER_A, { includeContent: true })
    const found = trash.find((n) => n.id === note.id)
    assert.ok(found)
    assert.equal(found?.title, "嘉策百煅手工T0")
    assert.equal(found?.content.includes("线下尽调"), true)
    assert.equal(found?.deletedBy, "G.Wave")
    assert.ok(found?.deletedAt)
  })

  it("restores a trashed note back to the live list", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "待恢复",
      content: "<p>body</p>",
      teamShared: false,
    })
    deleteServerInvestmentNote(note.id, USER_A, "G.Wave")
    const restored = restoreServerInvestmentNote(note.id, USER_A)
    assert.ok(restored)
    assert.equal(restored?.title, "待恢复")
    assert.equal(listServerInvestmentNotes("mine", USER_A).some((n) => n.id === note.id), true)
    assert.equal(listServerTrashedInvestmentNotes(USER_A).some((n) => n.id === note.id), false)
  })

  it("hides another user's private trash", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "私密",
      content: "<p>x</p>",
      teamShared: false,
    })
    deleteServerInvestmentNote(note.id, USER_A, "G.Wave")
    assert.equal(listServerTrashedInvestmentNotes(USER_B).some((n) => n.id === note.id), false)
  })

  it("permanently deletes from trash", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "彻底删除",
      content: "<p>x</p>",
      teamShared: false,
    })
    deleteServerInvestmentNote(note.id, USER_A, "G.Wave")
    assert.equal(purgeServerInvestmentNote(note.id, USER_A), true)
    assert.equal(listServerTrashedInvestmentNotes(USER_A).some((n) => n.id === note.id), false)
    assert.equal(listServerInvestmentNotes("mine", USER_A).some((n) => n.id === note.id), false)
  })

  it("purges notes older than the retention window", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "过期",
      content: "<p>old</p>",
      teamShared: false,
    })
    deleteServerInvestmentNote(note.id, USER_A, "G.Wave")
    const trashFile = path.join(tmpRoot, "investment-notes", "trash.json")
    const rows = JSON.parse(readFileSync(trashFile, "utf-8")) as Array<Record<string, unknown>>
    const target = rows.find((row) => row.id === note.id)
    assert.ok(target)
    target.deletedAt = new Date(
      Date.now() - (INVESTMENT_NOTE_TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString()
    writeFileSync(trashFile, JSON.stringify(rows), "utf-8")
    assert.equal(listServerTrashedInvestmentNotes(USER_A).some((n) => n.id === note.id), false)
  })

  it("empty trash removes notes the user can delete", () => {
    const note = createServerInvestmentNote(USER_A, "G.Wave", {
      title: "清空",
      content: "<p>x</p>",
      teamShared: false,
    })
    deleteServerInvestmentNote(note.id, USER_A, "G.Wave")
    const deleted = emptyServerInvestmentNoteTrash(USER_A)
    assert.ok(deleted >= 1)
    assert.equal(listServerTrashedInvestmentNotes(USER_A).some((n) => n.id === note.id), false)
  })
})
