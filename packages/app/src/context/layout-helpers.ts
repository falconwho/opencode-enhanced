import type { Accessor } from "solid-js"
import type { Project } from "@opencode-ai/sdk/v2"
import type { ProjectMeta } from "./global-sync/types"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function mergeProjectInfo(
  metadata: Partial<Project> | undefined,
  meta: ProjectMeta | undefined,
  local: { worktree: string; expanded: boolean },
): Partial<Project> & ProjectMeta & { worktree: string; expanded: boolean } {
  // Projects without server-side metadata (no row, or the shared "global" project used
  // by non-git directories) keep their name/icon/commands in local per-workspace state.
  const localMeta = !metadata || metadata.id === "global" ? meta : undefined
  return { ...metadata, ...localMeta, ...local }
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}
