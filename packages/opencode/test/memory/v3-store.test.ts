import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MemoryStore } from "../../src/memory/v3/store"

const roots: string[] = []

async function store() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-memory-v3-"))
  roots.push(root)
  return MemoryStore.open(path.join(root, "user.db"), "user", { autoSlot: true })
}

afterEach(() => {
  roots.splice(0)
})

describe("memory v3 store", () => {
  test("saves, deduplicates and searches Chinese memories", async () => {
    const db = await store()
    const first = db.save({ kind: "decision", scope: "user", content: "项目使用 bun 和 TypeScript", placard: "2026-11-02 项目技术栈" })
    expect(first.disposition).toBe("accept")
    expect(first.node?.slot?.room).toBe("decision")
    expect("review" in first.node!).toBe(false)
    expect("due" in db.stats()).toBe(false)
    const second = db.save({ kind: "decision", scope: "user", content: "项目使用 bun 和 TypeScript" })
    expect(second.disposition).toBe("merge")
    expect(db.fts(undefined, "项目技术栈", 10).length).toBe(1)
    db.close()
  })

  test("keeps explicit slot positions after forgetting", async () => {
    const db = await store()
    for (let i = 0; i < 10; i += 1) db.save({ kind: "fact", scope: "user", content: `fact number ${i}` })
    const nodes = db.list({ limit: 20 })
    const secondRoom = nodes.find((node) => node.slot?.room === "fact-2")
    expect(secondRoom).toBeDefined()
    const first = nodes.find((node) => node.slot?.room === "fact" && node.slot.index === 1)!
    db.setStatus(first.id, "forgotten")
    const next = db.save({ kind: "fact", scope: "user", content: "new fact after forget" })
    expect(next.node?.slot?.index).toBe(10)
    db.close()
  })

  test("stores profile, facts, observations and audit", async () => {
    const db = await store()
    db.setProfile("user", "Always answer in Chinese")
    expect(db.profile("user")?.content).toContain("Chinese")
    db.addFacts({ entity: "OpenCode", facts: [{ content: "uses SQLite" }] })
    expect(db.factsOfEntity({ entity: "OpenCode" }).items.length).toBe(1)
    db.addObservation({ scope: "user", belief: "User prefers concise answers", sources: ["mem_1"] })
    expect(db.observations().length).toBe(1)
    expect(db.audit().length).toBeGreaterThan(0)
    db.close()
  })
})
