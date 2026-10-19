import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  MEMORY_SECTIONS,
  SUMMARY_MAX_BYTES,
  isValidSummary,
  listMemory,
  listNotes,
  listRolloutFiles,
  pruneRollouts,
  readMemory,
  readRollout,
  readSummary,
  rolloutDir,
  searchMemory,
  truncateBytes,
  writeNote,
  writeRollout,
  writeSummary,
} from "../../src/memory/store"

const roots: string[] = []

async function tmpRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-memory-"))
  roots.push(dir)
  return dir
}

function validSummary(body = "profile") {
  return ["v1", ...MEMORY_SECTIONS.map((section) => `${section}\n${body}`)].join("\n")
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("truncateBytes", () => {
  test("keeps values under the limit unchanged", () => {
    expect(truncateBytes("hello", 5)).toBe("hello")
  })

  test("cuts on a code point boundary", () => {
    const value = "你好世界"
    expect(Buffer.byteLength(value, "utf8")).toBe(12)
    expect(truncateBytes(value, 7)).toBe("你好")
    expect(truncateBytes(value, 6)).toBe("你好")
    expect(truncateBytes(value, 5)).toBe("你")
  })
})

describe("isValidSummary", () => {
  test("accepts a v1 summary with every section", () => {
    expect(isValidSummary(validSummary())).toBe(true)
  })

  test("rejects a summary without the v1 marker or a missing section", () => {
    expect(isValidSummary(validSummary().replace("v1", "v2"))).toBe(false)
    expect(isValidSummary(validSummary().replace("## General Tips", "## Other"))).toBe(false)
  })

  test("rejects a summary over the size limit", () => {
    const summary = validSummary("x".repeat(SUMMARY_MAX_BYTES))
    expect(Buffer.byteLength(summary, "utf8")).toBeGreaterThan(SUMMARY_MAX_BYTES)
    expect(isValidSummary(summary)).toBe(false)
  })
})

describe("summary storage", () => {
  test("round-trips the summary with a trailing newline", async () => {
    const root = await tmpRoot()
    await writeSummary(root, validSummary())
    expect(await readSummary(root)).toBe(validSummary() + "\n")
  })

  test("reads an empty summary when the file is missing", async () => {
    const root = await tmpRoot()
    expect(await readSummary(root)).toBe("")
  })
})

describe("rollout storage", () => {
  test("writes and reads rollout summaries with a header", async () => {
    const root = await tmpRoot()
    const file = await writeRollout(root, {
      sessionID: "ses_1",
      updatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      cwd: "C:/work",
      gitBranch: "main",
      summary: "did some work",
      slug: "Fix Cache",
    })
    expect(file.endsWith(".md")).toBe(true)
    expect(file).toContain("fix_cache")
    const content = await readRollout(root, file)
    expect(content).toContain("session_id: ses_1")
    expect(content).toContain("git_branch: main")
    expect(content).toContain("did some work")
  })

  test("truncates oversized rollout summaries", async () => {
    const root = await tmpRoot()
    const file = await writeRollout(root, {
      sessionID: "ses_2",
      updatedAt: Date.now(),
      cwd: "C:/work",
      summary: "x".repeat(20_000),
    })
    const content = await readRollout(root, file)
    expect(Buffer.byteLength(content, "utf8")).toBeLessThan(10_000)
  })

  test("prunes rollouts beyond the keep limit", async () => {
    const root = await tmpRoot()
    for (const name of ["a", "b", "c"]) {
      await fs.mkdir(rolloutDir(root), { recursive: true })
      await fs.writeFile(path.join(rolloutDir(root), `${name}.md`), name, "utf8")
    }
    await pruneRollouts(root, 1)
    const files = await listRolloutFiles(root)
    expect(files).toHaveLength(1)
  })
})

describe("list and read", () => {
  test("lists entries without dotfiles and paginates", async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, "sub"), { recursive: true })
    await fs.writeFile(path.join(root, "a.md"), "a", "utf8")
    await fs.writeFile(path.join(root, "b.md"), "b", "utf8")
    await fs.writeFile(path.join(root, ".hidden"), "h", "utf8")
    const first = await listMemory(root, undefined, undefined, 1)
    expect(first.entries.map((entry) => entry.path)).toEqual(["a.md"])
    expect(first.truncated).toBe(true)
    expect(first.cursor).toBe("1")
    const second = await listMemory(root, undefined, first.cursor)
    expect(second.entries.map((entry) => entry.path)).toEqual(["b.md", "sub"])
    expect(second.truncated).toBe(false)
    expect(second.entries.find((entry) => entry.path === "sub")?.type).toBe("directory")
  })

  test("reads with a line offset and rejects traversal", async () => {
    const root = await tmpRoot()
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, "notes.md"), "one\ntwo\nthree", "utf8")
    const result = await readMemory(root, "notes.md", 2, 1)
    expect(result.content).toBe("two")
    expect(result.totalLines).toBe(3)
    await expect(readMemory(root, "../escape.md")).rejects.toThrow("invalid memory path")
    await expect(readMemory(root, path.resolve(root, "notes.md"))).rejects.toThrow("invalid memory path")
  })
})

describe("search", () => {
  test("finds matches in any or all mode with context", async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, "rollout_summaries"), { recursive: true })
    await fs.writeFile(
      path.join(root, "rollout_summaries", "one.md"),
      "alpha beta\ngamma delta\nepsilon",
      "utf8",
    )
    const any = await searchMemory(root, { queries: ["gamma"], contextLines: 1 })
    expect(any.matches).toHaveLength(1)
    expect(any.matches[0]!.line).toBe(2)
    expect(any.matches[0]!.context).toEqual(["alpha beta", "gamma delta", "epsilon"])

    const all = await searchMemory(root, { queries: ["alpha", "delta"], matchMode: "all" })
    expect(all.matches).toHaveLength(0)
    const allHit = await searchMemory(root, { queries: ["gamma", "delta"], matchMode: "all" })
    expect(allHit.matches).toHaveLength(1)
  })

  test("supports case-insensitive matching and skips non-text files", async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, "a.md"), "Needle", "utf8")
    await fs.writeFile(path.join(root, "b.bin"), "Needle", "utf8")
    const result = await searchMemory(root, { queries: ["needle"], caseSensitive: false })
    expect(result.matches.map((match) => match.path)).toEqual(["a.md"])
  })

  test("rejects empty queries", async () => {
    const root = await tmpRoot()
    await expect(searchMemory(root, { queries: ["  "] })).rejects.toThrow("search queries must not be empty")
  })
})

describe("ad-hoc notes", () => {
  const note = "2026-01-02T03-04-05-prefer-dark-mode.md"

  test("writes, lists and refuses duplicates", async () => {
    const root = await tmpRoot()
    await writeNote(root, note, "- prefers dark mode")
    const notes = await listNotes(root)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.file).toBe(note)
    expect(notes[0]!.note).toContain("prefers dark mode")
    await expect(writeNote(root, note, "again")).rejects.toThrow("note already exists")
  })

  test("rejects invalid filenames and empty notes", async () => {
    const root = await tmpRoot()
    await expect(writeNote(root, "nope.md", "x")).rejects.toThrow("invalid note filename")
    await expect(writeNote(root, "../escape.md", "x")).rejects.toThrow("invalid note filename")
    await expect(writeNote(root, note, "   ")).rejects.toThrow("note must not be empty")
  })
})
