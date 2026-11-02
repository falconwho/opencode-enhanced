import { Global } from "@opencode-ai/core/global"
import { createHash } from "node:crypto"
import path from "node:path"
import type { MemoryScope } from "./types"

export function memoryRoot() {
  return path.join(Global.Path.data, "memory")
}

export function v3Root() {
  return path.join(memoryRoot(), "v3")
}

export function legacyRoot(timestamp = new Date()) {
  return path.join(memoryRoot(), "legacy", `v2-${timestamp.toISOString().replace(/[:.]/g, "-")}`)
}

export function modelCacheRoot() {
  return path.join(v3Root(), "models")
}

export function projectKey(input: { projectID?: string; directory: string }) {
  if (input.projectID && input.projectID !== "global") return safeKey(input.projectID)
  return `cwd-${hash(input.directory.replaceAll("\\", "/").replace(/\/+$/, ""))}`
}

export function databasePath(scope: MemoryScope, project?: string) {
  if (scope === "user") return path.join(v3Root(), "user.db")
  if (scope === "shared") return path.join(v3Root(), "shared.db")
  return path.join(v3Root(), `project-${safeKey(project ?? "unknown")}.db`)
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function safeKey(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  return `${cleaned.slice(0, 48) || "project"}-${hash(value).slice(0, 12)}`
}
