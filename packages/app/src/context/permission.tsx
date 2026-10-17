import { createEffect, createMemo, createRoot, createSignal, getOwner, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import { useParams, useSearchParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { useSettings } from "./settings"
import { usePlatform } from "./platform"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { normalizePermissionRequest } from "./global-sync/utils"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
  sessionAutoAccept,
} from "./permission-auto-respond"
import {
  directoryMode as resolveDirectoryMode,
  resolvePermissionMode,
  READONLY_PERMISSIONS,
  type PermissionMode,
} from "./permission-mode"
import { authTokenFromCredentials } from "@/utils/server"
import { showToast } from "@/utils/toast"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
  // opencode-enhanced: optional reason sent with a reject so the server
  // resolves it as a CorrectedError (feedback reaches the model and the tool
  // card shows the human-readable reason) instead of a bare RejectedError.
  message?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const settings = useSettings()
    const platform = usePlatform()
    const owner = getOwner()
    const states = new Map<ServerScope, { key: ServerConnection.Key; dispose: () => void; state: PermissionState }>()

    const activeDraft = createMemo(() => {
      if (!search.draftId) return
      return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
    })

    const activeServer = createMemo(() => {
      if (params.serverKey && settings.general.newLayoutDesigns()) return requireServerKey(params.serverKey)
      return activeDraft()?.server ?? server.key
    })

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Permission server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing && global.servers.list().some((item) => ServerConnection.key(item) === existing.key)) {
        return existing.state
      }
      if (existing) {
        existing.dispose()
        states.delete(ctx.sdk.scope)
      }
      const root = createRoot(
        (dispose) => ({
          key,
          dispose,
          state: createServerPermissionState({
            sdk: ctx.sdk,
            sync: ctx.sync,
            approval: { model: settings.general.approvalModel, effort: settings.general.approvalEffort },
            fetch: platform.fetch,
          }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const list = global.servers.list()
      const keys = new Set(list.map(ServerConnection.key))
      states.forEach((value, scope) => {
        if (keys.has(value.key)) return
        value.dispose()
        states.delete(scope)
        const replacement = list.find((conn) => server.scope(ServerConnection.key(conn)) === scope)
        if (replacement) ensure(ServerConnection.key(replacement))
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    let lastSelected: PermissionState | undefined
    const selected = () => {
      const key = activeServer()
      if (global.servers.list().some((conn) => ServerConnection.key(conn) === key)) {
        lastSelected = ensure(key)
      }
      if (lastSelected) return lastSelected
      return ensure(server.key)
    }
    const activeDirectory = createMemo(() => {
      const directory = decode64(params.dir)
      if (directory) return directory
      const draft = activeDraft()
      if (draft) return draft.directory
      if (!params.id) return
      if (!global.servers.list().some((conn) => ServerConnection.key(conn) === activeServer())) return
      return selected().sync.session.lineage.peek(params.id)?.session.directory
    })

    createEffect(() => {
      const directory = activeDirectory()
      if (!directory) return
      selected().enableConfiguredDirectory(directory)
    })

    const permissionsEnabled = createMemo(() => {
      const directory = activeDirectory()
      if (!directory) return false
      return selected().permissionsEnabled(directory)
    })

    return {
      ready: () => selected().ready(),
      ensureServerState: (key: ServerConnection.Key) => ensure(key).api,
      currentServerState: () => selected().api,
      respond(input: Parameters<PermissionRespondFn>[0]) {
        selected().respond(input)
      },
      autoResponds(permission: PermissionRequest, directory?: string) {
        return selected().autoResponds(permission, directory)
      },
      isAutoAccepting(sessionID: string, directory?: string) {
        return selected().isAutoAccepting(sessionID, directory)
      },
      isAutoAcceptingDirectory(directory: string) {
        return selected().isAutoAcceptingDirectory(directory)
      },
      toggleAutoAccept(sessionID: string, directory: string) {
        selected().toggleAutoAccept(sessionID, directory)
      },
      modeFor(sessionID: string, directory: string) {
        return selected().modeFor(sessionID, directory)
      },
      setMode(sessionID: string, directory: string, mode: PermissionMode) {
        selected().setMode(sessionID, directory, mode)
      },
      directoryMode(directory: string) {
        return selected().directoryMode(directory)
      },
      setDirectoryMode(directory: string, mode: PermissionMode) {
        selected().setDirectoryMode(directory, mode)
      },
      toggleAutoAcceptDirectory(directory: string) {
        selected().toggleAutoAcceptDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        selected().enableAutoAccept(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        selected().disableAutoAccept(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        return selected().isPermissionAllowAll(directory)
      },
      isJudging(permissionID: string) {
        return selected().isJudging(permissionID)
      },
    }
  },
})

type PermissionState = ReturnType<typeof createServerPermissionState>
type PermissionEvent = Parameters<Parameters<ServerSDK["event"]["listen"]>[0]>[0]

function createServerPermissionState(input: {
  sdk: ServerSDK
  sync: ServerSync
  approval: { model: () => string; effort: () => "low" | "medium" | "high" }
  fetch?: typeof globalThis.fetch
}) {
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.serverGlobal(input.sdk.scope, "permission", ["permission.v3"]),
      migrate(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value

        const data = value as Record<string, unknown>
        if (data.autoAccept) return value

        return {
          ...data,
          autoAccept:
            typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
              ? data.autoAcceptEdits
              : {},
        }
      },
    },
    createStore({
      autoAccept: {} as Record<string, boolean>,
      modes: {} as Record<string, PermissionMode>,
    }),
  )

  function enableConfiguredDirectory(directory: string) {
    if (input.sdk.protocolKind() !== "v1") return
    if (meta.disposed || !ready()) return
    const [childStore] = input.sync.child(directory)
    if (childStore.config.permission !== "allow") return
    const key = directoryAcceptKey(directory)
    if (store.autoAccept[key] !== undefined) return
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )
  }

  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const responded = new Map<string, number>()
  const enableVersion = new Map<string, number>()
  const meta = { disposed: false }

  // opencode-enhanced F1/F8: keep the server-side memory extraction model and
  // reasoning effort in sync with the AI approval settings. Memory extraction
  // runs on the server at session idle, so unlike the approval judge it cannot
  // receive per-request values; the app pushes the current settings instead.
  const syncMemoryConfig = (model: string, effort: "low" | "medium" | "high") => {
    const http = input.sdk.server.http
    void (input.fetch ?? globalThis.fetch)(new URL("/memory/config", http.url).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(http.password
          ? { authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
          : {}),
      },
      body: JSON.stringify({ model, effort }),
    })
      .then((res) => {
        if (!res.ok) console.warn("[memory] config sync http error", res.status)
      })
      .catch((error: unknown) => console.warn("[memory] config sync failed", error))
  }

  createEffect(() => {
    syncMemoryConfig(input.approval.model(), input.approval.effort())
  })

  function pruneResponded(now: number) {
    for (const [id, ts] of responded) {
      if (now - ts < RESPONDED_TTL_MS) break
      responded.delete(id)
    }

    for (const id of responded.keys()) {
      if (responded.size <= MAX_RESPONDED) break
      responded.delete(id)
    }
  }

  const respond: PermissionRespondFn = (request) => {
    if (meta.disposed) return
    input.sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.permissionID,
        reply: request.response,
        location: request.directory ? { directory: request.directory } : undefined,
        ...(request.message ? { message: request.message } : {}),
      })
      .catch(() => {
        responded.delete(request.permissionID)
      })
  }

  const list = async (directory: string) => {
    if ((await input.sdk.protocol) === "v1") {
      return (await input.sdk.client.permission.list({ directory })).data ?? []
    }
    return input.sdk.api.permission.request
      .list({ location: { directory } })
      .then((result) => result.data.map(normalizePermissionRequest))
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function sessions(directory?: string) {
    const info = Object.values(input.sync.session.data.info).filter((session) => !!session)
    if (!directory) return info
    return [...info, ...input.sync.child(directory, { bootstrap: false })[0].session]
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    return autoRespondsPermission(store.autoAccept, sessions(directory), { sessionID }, directory)
  }

  function isAutoAcceptingDirectory(directory: string) {
    return isDirectoryAutoAccepting(store.autoAccept, directory)
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    return autoRespondsPermission(store.autoAccept, sessions(directory), permission, directory)
  }

  function isPending(permission: PermissionRequest) {
    const pending = input.sync.session.data.permission[permission.sessionID]
    return pending === undefined || pending.some((item) => item.id === permission.id)
  }

  async function shouldAutoRespondResolved(permission: PermissionRequest, directory?: string) {
    const override = sessionAutoAccept(store.autoAccept, sessions(directory), permission, directory)
    if (override !== undefined) return override
    if (input.sync.session.lineage.peek(permission.sessionID)) return shouldAutoRespond(permission, directory)
    const lineage = await input.sync.session.lineage.resolve(permission.sessionID).catch(() => undefined)
    if (meta.disposed || !lineage) return false
    return shouldAutoRespond(permission, directory)
  }

  async function respondPending(
    permission: PermissionRequest,
    directory?: string,
    current: () => boolean = () => true,
  ) {
    if (!current() || !isPending(permission)) return
    const mode = resolvePermissionMode(store.modes, sessions(directory), permission, directory)
    // opencode-enhanced F1 debug: pinpoint why permission modes don't resolve.
    console.info("[perm-mode] asked", {
      permission: permission.permission,
      sessionID: permission.sessionID,
      directory,
      resolvedMode: mode,
      modeKeys: Object.keys(store.modes),
    })
    if (mode === "ask") return
    if (mode === "readonly") {
      if (meta.disposed || !current() || !isPending(permission)) return
      if (READONLY_PERMISSIONS.has(permission.permission)) {
        respondOnce(permission, directory)
        return
      }
      respond({ sessionID: permission.sessionID, permissionID: permission.id, response: "reject", directory })
      return
    }
    if (mode === "ai") {
      void judgeAndRespond(permission, directory)
      return
    }
    if (mode !== "full" && !(await shouldAutoRespondResolved(permission, directory))) return
    if (meta.disposed || !current() || !isPending(permission)) return
    respondOnce(permission, directory)
  }

  // opencode-enhanced F1: judge permission requests with a small model via the
  // server-side approval endpoint. Failures leave the request pending so the
  // user is prompted (safe fallback); failures are surfaced, not silent.
  const judging = new Set<string>()
  const [judgingTick, setJudgingTick] = createSignal(0)
  const bumpJudging = () => setJudgingTick((value) => value + 1)

  // opencode-enhanced: clear stale judging markers once the underlying
  // permission request has actually disappeared from the sync store (the
  // server removes it asynchronously after an allow/deny reply). Keeps the
  // dock from flashing between the judge reply and the server-side removal.
  createEffect(() => {
    const pending = new Set(
      Object.values(input.sync.session.data.permission).flatMap((items) => items.map((item) => item.id)),
    )
    let changed = false
    for (const id of [...judging]) {
      if (!pending.has(id)) {
        judging.delete(id)
        changed = true
      }
    }
    if (changed) bumpJudging()
  })

  // opencode-enhanced: transient judge failures (HTTP error / exception) are
  // retried up to JUDGE_MAX_RETRIES times with a JUDGE_RETRY_DELAY_MS pause
  // before falling back to manual approval. The judging marker stays set during
  // retries so the dock never appears mid-retry.
  const JUDGE_MAX_RETRIES = 5
  const JUDGE_RETRY_DELAY_MS = 3000

  async function judgeAndRespond(permission: PermissionRequest, directory?: string) {
    if (judging.has(permission.id) || meta.disposed) return
    judging.add(permission.id)
    bumpJudging()
    let decision: string | undefined
    let lastStatus: number | undefined
    let lastError: unknown
    try {
      const http = input.sdk.server.http
      const url = new URL("/permission/ai-judge", http.url)
      if (directory) url.searchParams.set("directory", directory)
      console.info("[ai-approval] judging", permission.id, permission.permission, permission.patterns)
      for (let attempt = 1; attempt <= JUDGE_MAX_RETRIES && !meta.disposed; attempt++) {
        if (attempt > 1) console.info("[ai-approval] judge retry", permission.id, `attempt ${attempt}/${JUDGE_MAX_RETRIES}`)
        try {
          const res = await (input.fetch ?? globalThis.fetch)(url.toString(), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(http.password
                ? {
                    authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
                  }
                : {}),
            },
            body: JSON.stringify({
              sessionID: permission.sessionID,
              permission: permission.permission,
              patterns: permission.patterns ?? [],
              // opencode-enhanced: only include optional fields when set; the
              // server schema rejects null metadata/tool with HTTP 400.
              ...(permission.metadata ? { metadata: permission.metadata } : {}),
              ...(permission.tool ? { tool: permission.tool } : {}),
              model: input.approval.model(),
              effort: input.approval.effort(),
            }),
          })
          if (!res.ok) {
            lastStatus = res.status
            console.warn("[ai-approval] judge http error", res.status, `attempt ${attempt}/${JUDGE_MAX_RETRIES}`)
            if (attempt < JUDGE_MAX_RETRIES) {
              await sleep(JUDGE_RETRY_DELAY_MS)
              continue
            }
            showToast({
              title: "AI 审批不可用",
              description: `审批模型请求失败（HTTP ${res.status}，重试 ${JUDGE_MAX_RETRIES} 次后），已转为人工确认`,
            })
            return
          }
          const data = (await res.json()) as { decision?: string; reason?: string }
          console.info("[ai-approval] judge result", permission.id, data.decision, data.reason)
          decision = data.decision
          if (meta.disposed || !isPending(permission)) return
          if (data.decision === "allow") {
            respondOnce(permission, directory)
            return
          }
          if (data.decision === "deny") {
            respond({
              sessionID: permission.sessionID,
              permissionID: permission.id,
              response: "reject",
              directory,
              // opencode-enhanced: carry the judge's reason to the model (and the
              // rejected tool card) so the agent knows why and can continue.
              message: data.reason ? `AI 审批拒绝了：${data.reason}` : "AI 审批拒绝了该操作",
            })
            return
          }
        } catch (error) {
          lastError = error
          console.error("[ai-approval] judge failed", error, `attempt ${attempt}/${JUDGE_MAX_RETRIES}`)
          if (attempt < JUDGE_MAX_RETRIES) {
            await sleep(JUDGE_RETRY_DELAY_MS)
            continue
          }
          showToast({
            title: "AI 审批异常",
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      // opencode-enhanced: on a decided path (allow/deny) the server removes
      // the request asynchronously - keep the judging marker so the dock never
      // flashes; the createEffect above clears it once the request is gone.
      // On failure (all retries exhausted) the marker is dropped so the dock
      // appears for manual review.
      if (decision !== "allow" && decision !== "deny") {
        judging.delete(permission.id)
        bumpJudging()
      }
    }
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  const handlePermission = (e: PermissionEvent) => {
    const event = e.details
    if (event?.type !== "permission.asked") return
    void respondPending(event.properties, e.name)
  }

  const unsubscribe = input.sdk.event.listen((event) => {
    if (ready()) {
      handlePermission(event)
      return
    }
    void ready.promise?.then(() => {
      if (meta.disposed) return
      handlePermission(event)
    })
  })
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  function enableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (!isAutoAcceptingDirectory(directory)) return
        for (const permission of permissions) {
          void respondPending(permission, directory, () => isAutoAcceptingDirectory(directory))
        }
      })
      .catch(() => undefined)
  }

  function disableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
      }),
    )
  }

  function enable(sessionID: string, directory: string) {
    if (meta.disposed) return
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
        delete draft.autoAccept[sessionID]
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (enableVersion.get(key) !== version) return
        if (!isAutoAccepting(sessionID, directory)) return
        for (const permission of permissions) {
          void respondPending(
            permission,
            directory,
            () => enableVersion.get(key) === version && isAutoAccepting(sessionID, directory),
          )
        }
      })
      .catch(() => undefined)
  }

  function disable(sessionID: string, directory?: string) {
    if (meta.disposed) return
    bumpEnableVersion(sessionID, directory)
    const key = directory ? acceptKey(sessionID, directory) : sessionID
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
        if (!directory) return
        delete draft.autoAccept[sessionID]
      }),
    )
  }

  const api = {
    ready: () => !meta.disposed && ready(),
    respond,
    autoResponds(permission: PermissionRequest, directory?: string) {
      if (meta.disposed) return false
      return shouldAutoRespond(permission, directory)
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      if (meta.disposed) return false
      return isAutoAccepting(sessionID, directory)
    },
    isAutoAcceptingDirectory(directory: string) {
      if (meta.disposed) return false
      return isAutoAcceptingDirectory(directory)
    },
    modeFor(sessionID: string, directory?: string): PermissionMode {
      if (meta.disposed) return "ask"
      const mode = resolvePermissionMode(store.modes, sessions(directory), { sessionID }, directory)
      if (mode) return mode
      return isAutoAccepting(sessionID, directory) ? "full" : "ask"
    },
    setMode(sessionID: string, directory: string, mode: PermissionMode) {
      if (meta.disposed) return
      const key = acceptKey(sessionID, directory)
      console.info("[perm-mode] setMode", { key, mode, directory, sessionID })
      setStore(
        produce((draft) => {
          draft.modes[key] = mode
          delete draft.modes[sessionID]
        }),
      )
    },
    directoryMode(directory: string): PermissionMode {
      if (meta.disposed) return "ask"
      return resolveDirectoryMode(store.modes, directory) ?? (isAutoAcceptingDirectory(directory) ? "full" : "ask")
    },
    setDirectoryMode(directory: string, mode: PermissionMode) {
      if (meta.disposed) return
      const key = directoryAcceptKey(directory)
      console.info("[perm-mode] setDirectoryMode", { key, mode, directory })
      setStore(
        produce((draft) => {
          draft.modes[key] = mode
        }),
      )
    },
    toggleAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) {
        disable(sessionID, directory)
        return
      }

      enable(sessionID, directory)
    },
    toggleAutoAcceptDirectory(directory: string) {
      if (meta.disposed) return
      if (isAutoAcceptingDirectory(directory)) {
        disableDirectory(directory)
        return
      }
      enableDirectory(directory)
    },
    enableAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) return
      enable(sessionID, directory)
    },
    disableAutoAccept(sessionID: string, directory?: string) {
      if (meta.disposed) return
      disable(sessionID, directory)
    },
    isPermissionAllowAll(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return childStore.config.permission === "allow"
    },
    isJudging(permissionID: string) {
      void judgingTick()
      return judging.has(permissionID)
    },
  }

  return {
    ...api,
    api,
    sync: input.sync,
    enableConfiguredDirectory,
    permissionsEnabled(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return hasPermissionPromptRules(childStore.config.permission)
    },
  }
}
