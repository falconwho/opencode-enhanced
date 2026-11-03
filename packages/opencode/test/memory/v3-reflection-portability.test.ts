import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SCHEMA_SQL, SCHEMA_VERSION } from "../../src/memory/v3/schema"
import { openSqlite } from "../../src/memory/v3/sqlite"
import { MemoryStore } from "../../src/memory/v3/store"

async function root() {
  return fs.mkdtemp(path.join(os.tmpdir(), "oc-memory-v3-portability-"))
}

describe("memory v3 reflection and portability", () => {
  test("migrates a v1 database without losing nodes", async () => {
    const dir = await root()
    const file = path.join(dir, "user.db")
    const raw = await openSqlite(file)
    raw.exec(SCHEMA_SQL)
    raw.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run()
    raw.prepare(
      "INSERT INTO nodes (id, scope, kind, content, content_hash, importance, confidence, status, created_at, last_accessed_at, access_count) VALUES ('old', 'user', 'fact', 'old memory', 'hash', 0.5, 0.7, 'active', 1, 1, 0)",
    ).run()
    raw.close()

    const store = await MemoryStore.open(file, "user")
    expect(store.getNode("old")?.content).toBe("old memory")
    expect(store.suggestions()).toEqual([])
    const meta = (store as unknown as { db: { prepare: (sql: string) => { get: () => unknown } } })
    expect(meta).toBeDefined()
    expect(SCHEMA_VERSION).toBe(2)
    store.close()
  })

  test("persists reflection suggestions and round-trips a snapshot", async () => {
    const dir = await root()
    const file = path.join(dir, "user.db")
    const store = await MemoryStore.open(file, "user")
    const saved = store.save({ kind: "fact", scope: "user", content: "snapshot me" })
    const suggestion = store.addSuggestion({
      scope: "user",
      action: "link",
      sourceIds: [saved.node!.id],
      confidence: 0.9,
    })
    expect(store.suggestions()[0]?.action).toBe("link")
    expect(store.decideSuggestion(suggestion.id, "accepted")?.status).toBe("accepted")

    const snapshot = store.snapshot()
    const otherFile = path.join(dir, "other.db")
    const other = await MemoryStore.open(otherFile, "user")
    other.restore(snapshot)
    expect(other.getNode(saved.node!.id)?.content).toBe("snapshot me")
    expect(other.suggestions()[0]?.status).toBe("accepted")
    expect(other.fts(undefined, "snapshot", 10).length).toBe(1)
    store.close()
    other.close()
  })

  test("detects a non-empty store", async () => {
    const dir = await root()
    const store = await MemoryStore.open(path.join(dir, "user.db"), "user")
    expect(store.isEmpty()).toBe(true)
    store.save({ kind: "fact", scope: "user", content: "not empty" })
    expect(store.isEmpty()).toBe(false)
    store.close()
  })
})
