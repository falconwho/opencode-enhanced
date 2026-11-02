import fs from "node:fs/promises"
import path from "node:path"
import { legacyRoot, memoryRoot } from "./paths"
import type { MemoryStore } from "./store"

const SUMMARY = "memory_summary.md"
const ROLLOUTS = "rollout_summaries"
const NOTES = path.join("extensions", "ad_hoc", "notes")

export async function migrateV2(user: MemoryStore, project: MemoryStore) {
  if (user.meta("v2_migrated_at")) return
  const root = memoryRoot()
  const summary = await fs.readFile(path.join(root, SUMMARY), "utf8").catch(() => "")
  const rollouts = await fs.readdir(path.join(root, ROLLOUTS), { withFileTypes: true }).catch(() => [])
  const notes = await fs.readdir(path.join(root, NOTES), { withFileTypes: true }).catch(() => [])
  if (!summary.trim() && !rollouts.length && !notes.length) {
    user.setMeta("v2_migrated_at", String(Date.now()))
    return
  }
  const legacy = legacyRoot()
  await fs.mkdir(legacy, { recursive: true }).catch(() => undefined)
  await fs.copyFile(path.join(root, SUMMARY), path.join(legacy, SUMMARY)).catch(() => undefined)
  await fs.cp(path.join(root, ROLLOUTS), path.join(legacy, ROLLOUTS), { recursive: true, force: false }).catch(() => undefined)
  await fs.cp(path.join(root, NOTES), path.join(legacy, NOTES), { recursive: true, force: false }).catch(() => undefined)
  const now = Date.now()
  if (summary.trim()) {
    for (const block of splitSections(summary)) {
      if (!block.content.trim()) continue
      const kind = /user profile|preference|偏好|画像/i.test(block.title) ? "preference" : "fact"
      user.save({ kind, scope: "user", content: block.content.slice(0, 8_000), importance: 0.6, sourceSeq: now })
    }
  }
  for (const entry of rollouts) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const content = await fs.readFile(path.join(root, ROLLOUTS, entry.name), "utf8").catch(() => "")
    if (!content.trim()) continue
    project.save({ kind: "episode", scope: "project", content: content.slice(0, 8_000), importance: 0.5, sourceSeq: now })
  }
  for (const entry of notes) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const content = await fs.readFile(path.join(root, NOTES, entry.name), "utf8").catch(() => "")
    if (!content.trim()) continue
    user.save({ kind: "preference", scope: "user", content: content.slice(0, 8_000), importance: 0.6, sourceSeq: now })
  }
  user.setMeta("v2_migrated_at", String(now))
}

function splitSections(value: string) {
  const lines = value.split(/\r?\n/)
  const result: Array<{ title: string; content: string }> = []
  let title = "memory"
  let content: string[] = []
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (content.length) result.push({ title, content: content.join("\n").trim() })
      title = line.slice(3).trim()
      content = []
    } else {
      content.push(line)
    }
  }
  if (content.length) result.push({ title, content: content.join("\n").trim() })
  return result
}
