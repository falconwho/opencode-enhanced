import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { distillStore, parseDistill } from "../../src/memory/v3/distill"
import { MemoryStore } from "../../src/memory/v3/store"

describe("memory v3 distill", () => {
  test("parses valid distill output and rejects malformed entries", () => {
    const items = parseDistill(
      JSON.stringify([
        { content: "  project uses bun  ", kind: "fact", importance: 0.8, supersedes: ["a", "a", "b"] },
        { content: "", kind: "fact", supersedes: ["a"] },
        { content: "no ids", kind: "skill", supersedes: [] },
      ]),
    )
    expect(items).toEqual([
      { content: "project uses bun", kind: "fact", importance: 0.8, supersedes: ["a", "b"] },
    ])
  })

  test("supersedes active memories and archives the sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-memory-distill-"))
    const db = await MemoryStore.open(path.join(root, "user.db"), "user", { autoSlot: true })
    const first = db.save({ kind: "fact", scope: "user", content: "project uses bun" })
    const second = db.save({ kind: "fact", scope: "user", content: "project uses typescript" })
    const node = db.supersedeMany(
      { kind: "fact", content: "project uses bun and typescript", importance: 0.8, confidence: 0.9 },
      [first.node!.id, second.node!.id],
    )
    expect(node?.status).toBe("active")
    expect(db.getNode(first.node!.id)?.status).toBe("archived")
    expect(db.getNode(second.node!.id)?.status).toBe("archived")
    expect(db.topActive().map((item) => item.id)).toContain(node!.id)
    db.close()
  })

  test("runs the distill flow through a model callback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-memory-distill-flow-"))
    const db = await MemoryStore.open(path.join(root, "user.db"), "user", { autoSlot: true })
    const first = db.save({ kind: "fact", scope: "user", content: "project uses bun" })
    const second = db.save({ kind: "fact", scope: "user", content: "project uses typescript" })
    const result = await Effect.runPromise(
      distillStore(db, () =>
        Effect.succeed(
          JSON.stringify([
            {
              content: "project uses bun and typescript",
              kind: "fact",
              importance: 0.8,
              supersedes: [first.node!.id, second.node!.id],
            },
          ]),
        ),
      ),
    )
    expect(result.distilled).toBe(1)
    expect(result.superseded).toBe(2)
    expect(db.topActive()).toHaveLength(1)
    db.close()
  })
})
