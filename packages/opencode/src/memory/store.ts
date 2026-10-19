import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

// opencode-enhanced: memory v2 storage. The injected artifact is a single
// bounded summary; detailed per-session records live in rollout_summaries and
// are only read on demand. Files stay under the memory root and every path is
// validated before use.

export const SUMMARY_FILE = "memory_summary.md"
export const SUMMARY_MAX_BYTES = 10_000
export const SUMMARY_INJECT_MAX_BYTES = 9_000
export const ROLLOUT_MAX_BYTES = 9_000
export const ROLLOUT_KEEP_LIMIT = 256
export const NOTES_DIR = path.join("extensions", "ad_hoc", "notes")
export const STATE_FILE = ".state.json"
export const MEMORY_SECTIONS = ["## User Profile", "## User preferences", "## General Tips", "## What's in Memory"]

export type RolloutRecord = {
  sessionID: string
  updatedAt: number
  cwd: string
  gitBranch?: string
  summary: string
  slug?: string
}

export type NoteRecord = {
  file: string
  note: string
  hash: string
}

export type MemoryState = {
  version: 1
  processed: Record<
    string,
    {
      messageID: string
      updatedAt: number
      file?: string
      failedAt?: number
    }
  >
  notes: Record<string, string>
  lastConsolidatedAt?: number
  pendingConsolidation?: boolean
}

export function summaryFile(root: string) {
  return path.join(root, SUMMARY_FILE)
}

export function rolloutDir(root: string) {
  return path.join(root, "rollout_summaries")
}

export function notesDir(root: string) {
  return path.join(root, NOTES_DIR)
}

export function stateFile(root: string) {
  return path.join(root, STATE_FILE)
}

export async function ensureLayout(root: string) {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(rolloutDir(root), { recursive: true })
  await fs.mkdir(notesDir(root), { recursive: true })
}

export function truncateBytes(value: string, maxBytes: number) {
  const buffer = Buffer.from(value, "utf8")
  if (buffer.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && ((buffer[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1
  return buffer.subarray(0, end).toString("utf8")
}

export function isValidSummary(value: string) {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith("v1")) return false
  if (Buffer.byteLength(value, "utf8") > SUMMARY_MAX_BYTES) return false
  return MEMORY_SECTIONS.every((section) => value.includes(section))
}

export function slugify(value: string | undefined) {
  if (!value) return undefined
  let slug = ""
  for (const char of value) {
    if (slug.length >= 60) break
    slug += /[a-zA-Z0-9]/.test(char) ? char.toLowerCase() : "_"
  }
  slug = slug.replace(/_+$/, "")
  return slug || undefined
}

function shortHash(value: string) {
  const digest = createHash("sha256").update(value).digest()
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const parsed = digest.readUInt32BE(0) % 14_776_336
  let current = parsed
  let out = ""
  for (let i = 0; i < 4; i++) {
    out = alphabet[current % alphabet.length] + out
    current = Math.floor(current / alphabet.length)
  }
  return out
}

function timestamp(value: number) {
  return new Date(value).toISOString().slice(0, 19).replace(/:/g, "-")
}

export function rolloutFileName(record: RolloutRecord) {
  const prefix = `${timestamp(record.updatedAt)}-${shortHash(record.sessionID)}`
  const slug = slugify(record.slug)
  return slug ? `${prefix}-${slug}.md` : `${prefix}.md`
}

function resolveInside(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative)) throw new Error(`invalid memory path: ${relative}`)
  const normalized = relative.replaceAll("\\", "/")
  const parts = normalized.split("/").filter((part) => part && part !== ".")
  if (parts.some((part) => part === "..")) throw new Error(`invalid memory path: ${relative}`)
  const target = path.resolve(root, ...parts)
  const base = path.resolve(root)
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`invalid memory path: ${relative}`)
  return { target, parts }
}

async function assertNoSymlink(root: string, parts: string[]) {
  let current = path.resolve(root)
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const info = await fs.lstat(current)
      if (info.isSymbolicLink()) throw new Error(`refusing to follow symlink: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
  }
}

async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, content, "utf8")
  await fs.rename(temp, file)
}

export async function readSummary(root: string) {
  return fs.readFile(summaryFile(root), "utf8").catch(() => "")
}

export async function writeSummary(root: string, content: string) {
  await ensureLayout(root)
  await writeAtomic(summaryFile(root), content.endsWith("\n") ? content : content + "\n")
}

export async function writeRollout(root: string, record: RolloutRecord) {
  await ensureLayout(root)
  const summary = truncateBytes(record.summary.trim(), ROLLOUT_MAX_BYTES)
  const file = rolloutFileName(record)
  const header = [
    `session_id: ${record.sessionID}`,
    `updated_at: ${new Date(record.updatedAt).toISOString()}`,
    `cwd: ${record.cwd}`,
    ...(record.gitBranch ? [`git_branch: ${record.gitBranch}`] : []),
    "",
  ].join("\n")
  await fs.writeFile(path.join(rolloutDir(root), file), `${header}${summary}\n`, "utf8")
  return file
}

export async function listRolloutFiles(root: string) {
  const entries = await fs.readdir(rolloutDir(root), { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const info = await fs.stat(path.join(rolloutDir(root), entry.name)).catch(() => undefined)
        return { file: entry.name, mtime: info?.mtimeMs ?? 0, size: info?.size ?? 0 }
      }),
  )
  return files.sort((a, b) => b.mtime - a.mtime)
}

export async function pruneRollouts(root: string, keep = ROLLOUT_KEEP_LIMIT) {
  const files = await listRolloutFiles(root)
  for (const entry of files.slice(keep)) {
    await fs.rm(path.join(rolloutDir(root), entry.file), { force: true })
  }
}

export async function readRollout(root: string, file: string) {
  const { target, parts } = resolveInside(root, path.join("rollout_summaries", file))
  await assertNoSymlink(root, parts)
  return fs.readFile(target, "utf8").catch(() => "")
}

export async function listNotes(root: string): Promise<NoteRecord[]> {
  const entries = await fs.readdir(notesDir(root), { withFileTypes: true }).catch(() => [])
  const result: NoteRecord[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const note = await fs.readFile(path.join(notesDir(root), entry.name), "utf8").catch(() => "")
    if (!note.trim()) continue
    result.push({ file: entry.name, note, hash: createHash("sha256").update(note).digest("hex") })
  }
  return result.sort((a, b) => a.file.localeCompare(b.file))
}

export async function writeNote(root: string, file: string, note: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,79}\.md$/.test(file))
    throw new Error("invalid note filename")
  if (!note.trim()) throw new Error("note must not be empty")
  await ensureLayout(root)
  const target = path.join(notesDir(root), file)
  try {
    await fs.access(target)
    throw new Error(`note already exists: ${file}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  await fs.writeFile(target, note.endsWith("\n") ? note : note + "\n", { encoding: "utf8", flag: "wx" })
  return file
}

export async function readState(root: string): Promise<MemoryState> {
  const raw = await fs.readFile(stateFile(root), "utf8").catch(() => "")
  if (!raw.trim()) return { version: 1, processed: {}, notes: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryState>
    return {
      version: 1,
      processed: parsed.processed ?? {},
      notes: parsed.notes ?? {},
      lastConsolidatedAt: parsed.lastConsolidatedAt,
      pendingConsolidation: parsed.pendingConsolidation,
    }
  } catch {
    return { version: 1, processed: {}, notes: {} }
  }
}

export async function writeState(root: string, state: MemoryState) {
  await ensureLayout(root)
  await writeAtomic(stateFile(root), JSON.stringify(state, null, 2) + "\n")
}

export async function listMemory(root: string, relative?: string, cursor?: string, maxResults = 2000) {
  const scope = relative?.trim() ? relative : ""
  const { target, parts } = scope ? resolveInside(root, scope) : { target: root, parts: [] as string[] }
  await assertNoSymlink(root, parts)
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  const items = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const rel = [scope, entry.name].filter(Boolean).join("/")
      return { path: rel, type: entry.isDirectory() ? ("directory" as const) : ("file" as const) }
    })
  const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0
  const page = items.slice(offset, offset + Math.min(maxResults, 2000))
  const next = offset + page.length < items.length ? String(offset + page.length) : undefined
  return { entries: page, truncated: !!next, cursor: next }
}

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl"])

async function walkTextFiles(root: string, relative: string | undefined, out: string[], depth = 0) {
  if (depth > 4) return
  const base = relative?.trim() ? relative : ""
  const { target, parts } = base ? resolveInside(root, base) : { target: root, parts: [] as string[] }
  await assertNoSymlink(root, parts)
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const rel = [base, entry.name].filter(Boolean).join("/")
    if (entry.isDirectory()) {
      await walkTextFiles(root, rel, out, depth + 1)
      continue
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    out.push(rel)
  }
}

export type SearchInput = {
  queries: string[]
  matchMode?: "any" | "all"
  path?: string
  contextLines?: number
  caseSensitive?: boolean
  normalized?: boolean
  cursor?: string
  maxResults?: number
}

export async function searchMemory(root: string, input: SearchInput) {
  const queries = input.queries.map((query) => query.trim()).filter(Boolean)
  if (queries.length === 0) throw new Error("search queries must not be empty")
  const caseSensitive = input.caseSensitive ?? true
  const normalized = input.normalized ?? false
  const matchMode = input.matchMode ?? "any"
  const contextLines = Math.min(Math.max(input.contextLines ?? 0, 0), 10)
  const files: string[] = []
  await walkTextFiles(root, input.path, files)
  files.sort()
  const normalize = (value: string) => {
    const replaced = normalized ? value.replaceAll("\\", "/") : value
    return caseSensitive ? replaced : replaced.toLowerCase()
  }
  const needles = queries.map((query) => normalize(query))
  const matches: { path: string; line: number; text: string; context?: string[] }[] = []
  for (const file of files) {
    const content = await fs.readFile(path.join(root, file), "utf8").catch(() => "")
    if (!content) continue
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const haystack = normalize(lines[index] ?? "")
      const hit =
        matchMode === "all"
          ? needles.every((needle) => haystack.includes(needle))
          : needles.some((needle) => haystack.includes(needle))
      if (!hit) continue
      const context =
        contextLines > 0
          ? lines.slice(Math.max(0, index - contextLines), Math.min(lines.length, index + contextLines + 1))
          : undefined
      matches.push({ path: file, line: index + 1, text: lines[index] ?? "", context })
      break
    }
  }
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0
  const limit = Math.min(input.maxResults ?? 200, 200)
  const page = matches.slice(offset, offset + limit)
  const next = offset + page.length < matches.length ? String(offset + page.length) : undefined
  return { matches: page, truncated: !!next, cursor: next }
}

export async function readMemory(root: string, relative: string, lineOffset = 1, maxLines?: number) {
  const { target, parts } = resolveInside(root, relative)
  await assertNoSymlink(root, parts)
  const content = await fs.readFile(target, "utf8").catch(() => undefined)
  if (content === undefined) throw new Error(`memory file not found: ${relative}`)
  const lines = content.split(/\r?\n/)
  const offset = Math.max(1, lineOffset)
  const slice = lines.slice(offset - 1, maxLines ? offset - 1 + Math.max(1, maxLines) : undefined)
  const joined = slice.join("\n")
  const truncated = joined.length > 60_000
  return {
    path: relative,
    content: truncateBytes(joined, 60_000),
    lineOffset: offset,
    totalLines: lines.length,
    truncated,
  }
}
