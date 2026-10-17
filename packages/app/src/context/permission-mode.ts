import { acceptKey, directoryAcceptKey } from "./permission-auto-respond"

// opencode-enhanced F1: codex-style permission modes.
// - ask: always prompt the user (opencode default)
// - readonly: auto-allow read-only requests, auto-reject everything else
// - ai: a small model judges each request (fallback: prompt the user)
// - full: auto-allow everything (legacy "auto-accept permissions")
export type PermissionMode = "ask" | "readonly" | "ai" | "full"

export const PERMISSION_MODES: PermissionMode[] = ["ask", "readonly", "ai", "full"]

export const READONLY_PERMISSIONS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch"])

export { acceptKey as modeKey, directoryAcceptKey as directoryModeKey }

function lineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }
  return ids
}

export function sessionMode(
  modes: Record<string, PermissionMode>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return lineage(session, permission.sessionID)
    .map((id) => modes[acceptKey(id, directory)] ?? modes[id])
    .find((item): item is PermissionMode => item !== undefined)
}

export function directoryMode(modes: Record<string, PermissionMode>, directory: string) {
  return modes[directoryAcceptKey(directory)]
}

export function resolvePermissionMode(
  modes: Record<string, PermissionMode>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionMode(modes, session, permission, directory)
  if (value !== undefined) return value
  return directory ? directoryMode(modes, directory) : undefined
}
