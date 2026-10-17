import { createStore, produce } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import type { Session } from "@opencode-ai/sdk/v2/client"

// opencode-enhanced F3: per-project session subfolders.
// Pure UI organization metadata persisted in the desktop store (isolated
// userData); server session data is never touched.
export type SessionFolder = {
  id: string
  name: string
  collapsed: boolean
}

type FolderStore = {
  folders: SessionFolder[]
  assignments: Record<string, string>
}

export function createSessionFolders(directory: () => string) {
  const [store, setStore] = persisted(
    Persist.workspace(directory(), "session-folders.v1"),
    createStore<FolderStore>({ folders: [], assignments: {} }),
  )

  const create = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    setStore(
      produce((draft) => {
        draft.folders.push({ id, name: trimmed, collapsed: false })
      }),
    )
    return id
  }

  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setStore(
      produce((draft) => {
        const folder = draft.folders.find((item) => item.id === id)
        if (folder) folder.name = trimmed
      }),
    )
  }

  const remove = (id: string) => {
    setStore(
      produce((draft) => {
        draft.folders = draft.folders.filter((item) => item.id !== id)
        for (const key of Object.keys(draft.assignments)) {
          if (draft.assignments[key] === id) delete draft.assignments[key]
        }
      }),
    )
  }

  const toggleCollapsed = (id: string) => {
    setStore(
      produce((draft) => {
        const folder = draft.folders.find((item) => item.id === id)
        if (folder) folder.collapsed = !folder.collapsed
      }),
    )
  }

  const assign = (sessionID: string, folderID: string | undefined) => {
    setStore(
      produce((draft) => {
        if (folderID && draft.folders.some((item) => item.id === folderID)) {
          draft.assignments[sessionID] = folderID
          return
        }
        delete draft.assignments[sessionID]
      }),
    )
  }

  const folderOf = (sessionID: string) => store.assignments[sessionID]

  const grouped = (sessions: Session[]) => {
    const byFolder = new Map<string, Session[]>()
    const ungrouped: Session[] = []
    for (const session of sessions) {
      const folderID = store.assignments[session.id]
      if (folderID && store.folders.some((item) => item.id === folderID)) {
        const list = byFolder.get(folderID) ?? []
        list.push(session)
        byFolder.set(folderID, list)
        continue
      }
      ungrouped.push(session)
    }
    return { byFolder, ungrouped }
  }

  return {
    folders: () => store.folders,
    create,
    rename,
    remove,
    toggleCollapsed,
    assign,
    folderOf,
    grouped,
  }
}

export type SessionFolders = ReturnType<typeof createSessionFolders>
