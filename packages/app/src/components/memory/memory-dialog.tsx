import { Component, For, Show, createResource, createSignal } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useServerSDK } from "@/context/server-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { authTokenFromCredentials } from "@/utils/server"
import { showToast } from "@/utils/toast"

type Stats = {
  total?: number
  active?: number
  archived?: number
  byKind?: Record<string, number>
  rooms?: Array<{ room: string; count: number }>
}

type Node = {
  id: string
  scope: string
  kind: string
  content: string
  status: string
  importance?: number
  slot?: { room: string; index: number }
  createdAt?: number
}

type Profile = {
  current?: { content: string; version: number }
  versions?: Array<{ version: number; content: string; source: string; at: number }>
}

type Room = {
  room: string
  count: number
  nodes: Node[]
}

type Reflection = {
  id: string
  scope: string
  action: string
  sourceIds: string[]
  targetId?: string
  content?: string
  reason?: string
  confidence: number
  status: string
  createdAt: number
}

type AuditEntry = {
  seq: number
  at: number
  op: string
  targetID: string
  scope: string
  detail?: unknown
}

const tabs = ["概览", "记忆库", "画像", "整理", "记录", "运维"] as const

export const MemoryDialog: Component<{ sessionID?: string; directory?: string }> = (props) => {
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const [tab, setTab] = createSignal<(typeof tabs)[number]>("概览")
  const [profileText, setProfileText] = createSignal("")
  const [loadError, setLoadError] = createSignal<string>()
  let importRef: HTMLInputElement | undefined

  const url = (path: string) => {
    const params = new URLSearchParams()
    if (props.sessionID) params.set("sessionID", props.sessionID)
    if (props.directory) params.set("directory", props.directory)
    const separator = path.includes("?") ? "&" : "?"
    return new URL(`${path}${params.toString() ? separator + params.toString() : ""}`, serverSdk().server.http.url)
  }

  const requestInit = (init?: RequestInit) => {
    const http = serverSdk().server.http
    return {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(http.password
          ? { authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
          : {}),
        ...(init?.headers ?? {}),
      },
    }
  }

  const request = async (path: string, init?: RequestInit) => {
    const res = await fetch(url(path), requestInit(init))
    if (!res.ok) throw new Error(`memory request failed: ${res.status}`)
    return res.json()
  }

  const requestText = async (path: string) => {
    const res = await fetch(url(path), requestInit())
    if (!res.ok) throw new Error(`memory request failed: ${res.status}`)
    return res.text()
  }

  const load = async <T,>(path: string, fallback: T): Promise<T> => {
    try {
      return (await request(path)) as T
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
      return fallback
    }
  }

  const [stats, { refetch: refreshStats }] = createResource<Stats>(() => load("/memory/v3/stats", {}))
  const [rooms, { refetch: refreshRooms }] = createResource<Room[]>(() => load("/memory/v3/rooms", []))
  const [nodes, { refetch: refreshNodes }] = createResource<Node[]>(() => load("/memory/v3/nodes?limit=200", []))
  const [profile, { refetch: refreshProfile }] = createResource<Profile>(() => load("/memory/v3/profile", {}))
  const [reflections, { refetch: refreshReflections }] = createResource<Reflection[]>(() =>
    load("/memory/v3/reflect", []),
  )
  const [audit, { refetch: refreshAudit }] = createResource<AuditEntry[]>(() => load("/memory/v3/audit?limit=100", []))
  const [editing, setEditing] = createSignal<{ id: string; text: string }>()

  const refresh = () => {
    void refreshStats()
    void refreshRooms()
    void refreshNodes()
    void refreshProfile()
    void refreshReflections()
    void refreshAudit()
  }

  const mutate = async (node: Node, action: "update" | "archive" | "restore" | "forget", content?: string) => {
    try {
      await request("/memory/v3/mutate", {
        method: "POST",
        body: JSON.stringify({ id: node.id, action, content }),
      })
      refresh()
      showToast({
        title: { update: "记忆已更新", archive: "已归档", restore: "已恢复", forget: "已遗忘" }[action],
      })
      return true
    } catch (error) {
      showToast({ title: "记忆操作失败", description: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  const startEdit = (node: Node) => setEditing({ id: node.id, text: node.content })

  const cancelEdit = () => setEditing(undefined)

  const saveEdit = async (node: Node) => {
    const content = editing()?.text.trim() ?? ""
    if (!content) {
      showToast({ title: "记忆内容不能为空" })
      return
    }
    if (content !== node.content && !(await mutate(node, "update", content))) return
    cancelEdit()
  }

  const saveProfile = async () => {
    try {
      await request("/memory/v3/profile", {
        method: "POST",
        body: JSON.stringify({ content: profileText() }),
      })
      void refreshProfile()
      showToast({ title: "画像已保存" })
    } catch (error) {
      showToast({ title: "保存画像失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const runReflect = async () => {
    try {
      const result = (await request("/memory/v3/reflect/run", { method: "POST", body: "{}" })) as {
        created?: number
        applied?: number
      }
      refresh()
      showToast({ title: `整理完成：新增 ${result.created ?? 0} 条建议` })
    } catch (error) {
      showToast({ title: "整理失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const runDistill = async () => {
    try {
      const result = (await request("/memory/v3/distill", {
        method: "POST",
        body: JSON.stringify({ scope: "all" }),
      })) as { distilled?: number; superseded?: number; failed?: number }
      refresh()
      showToast({
        title: `蒸馏完成：新增 ${result.distilled ?? 0} 条，归档 ${result.superseded ?? 0} 条`,
      })
    } catch (error) {
      showToast({ title: "蒸馏失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const decideReflection = async (item: Reflection, action: "accept" | "reject") => {
    try {
      await request("/memory/v3/reflect/decide", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action }),
      })
      refresh()
    } catch (error) {
      showToast({ title: "整理操作失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const download = (filename: string, data: string, type = "application/json") => {
    const blob = new Blob([data], { type })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
  }

  const exportJson = async () => {
    try {
      const data = await requestText("/memory/v3/export?format=json")
      download(`opencode-memory-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, data)
      showToast({ title: "记忆备份已导出" })
    } catch (error) {
      showToast({ title: "导出失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const exportMarkdown = async () => {
    try {
      const data = await requestText("/memory/v3/export?format=markdown")
      download(`opencode-memory-${new Date().toISOString().slice(0, 10)}.md`, data, "text/markdown")
      showToast({ title: "Markdown 已导出" })
    } catch (error) {
      showToast({ title: "导出失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const backup = async () => {
    try {
      const result = (await request("/memory/v3/backup", { method: "POST", body: "{}" })) as { path?: string }
      showToast({ title: "备份完成", description: result.path })
    } catch (error) {
      showToast({ title: "备份失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const importFile = async (file: File) => {
    try {
      const data = await file.text()
      const result = (await request("/memory/v3/import", {
        method: "POST",
        body: JSON.stringify({ data }),
      })) as { imported?: number; error?: string }
      if (result.error) throw new Error(result.error)
      refresh()
      showToast({ title: `恢复完成：${result.imported ?? 0} 个节点` })
    } catch (error) {
      showToast({ title: "恢复失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const rebuild = async () => {
    try {
      const result = (await request("/memory/v3/rebuild-embeddings", { method: "POST", body: "{}" })) as {
        updated?: number
        failed?: number
      }
      showToast({ title: `embedding 完成：${result.updated ?? 0}，失败 ${result.failed ?? 0}` })
    } catch (error) {
      showToast({ title: "重建失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const clearAll = async () => {
    if (!confirm("确定清空所有 v3 记忆吗？旧 v2 备份不会被删除。")) return
    try {
      await request("/memory/v3/backup", { method: "POST", body: "{}" })
      await request("/memory/v3/clear", { method: "POST", body: "{}" })
      refresh()
      showToast({ title: "记忆已清空，已保留自动备份" })
    } catch (error) {
      showToast({ title: "清空失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Dialog size="x-large" class="h-[90vh]">
      <div class="flex h-full min-h-0 flex-col gap-5 p-6">
        <div class="flex items-start justify-between gap-3 border-b border-border-base pb-4">
          <div>
            <div class="text-16-medium text-text-strong">记忆库</div>
            <div class="text-12-regular text-text-weak">本地长期记忆 · {props.sessionID ?? "当前会话"}</div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="small"
              variant="ghost"
              class="gap-1 border border-border-base"
              onClick={() => dialog.close()}
            >
              <Icon name="arrow-left" size="small" />
              返回设置
            </Button>
            <For each={tabs}>
              {(item) => (
                <Button size="small" variant={tab() === item ? "primary" : "ghost"} onClick={() => setTab(item)}>
                  {item}
                </Button>
              )}
            </For>
          </div>
        </div>

        <Show when={loadError()}>
          {(message) => (
            <div class="flex items-center justify-between gap-3 rounded border border-border-danger-base px-3 py-2 text-12-regular text-text-danger-base">
              <span class="min-w-0 break-all">记忆库加载失败：{message()}</span>
              <Button size="small" variant="ghost" onClick={refresh}>
                重试
              </Button>
            </div>
          )}
        </Show>

        <div class="min-h-0 flex-1 overflow-auto pr-1">
          <Show when={tab() === "概览"}>
            <div class="grid grid-cols-4 gap-2">
              <Metric label="总数" value={stats()?.total ?? 0} />
              <Metric label="active" value={stats()?.active ?? 0} />
              <Metric label="归档/遗忘" value={stats()?.archived ?? 0} />
              <Metric label="房间" value={stats()?.rooms?.length ?? 0} />
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2">
              <For each={rooms() ?? []}>
                {(room) => (
                  <div class="rounded border border-border-base px-3 py-2 text-12-regular">
                    <span class="text-text-strong">{room.room}</span>
                    <span class="ml-2 text-text-weak">{room.count} 条</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={tab() === "记忆库"}>
            <For each={nodes() ?? []}>
              {(node) => (
                <div class="mb-2 rounded border border-border-base p-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-regular text-text-weak">
                      [{node.scope}/{node.kind}] {node.status}
                      {node.slot ? ` · ${node.slot.room}#${node.slot.index}` : ""}
                    </div>
                    <div class="flex gap-1">
                      <Show
                        when={editing()?.id === node.id}
                        fallback={
                          <>
                            <Button size="small" variant="ghost" onClick={() => startEdit(node)}>
                              编辑
                            </Button>
                            <Button size="small" variant="ghost" onClick={() => void mutate(node, "archive")}>
                              归档
                            </Button>
                            <Button size="small" variant="ghost" onClick={() => void mutate(node, "restore")}>
                              恢复
                            </Button>
                            <Button size="small" variant="ghost" onClick={() => void mutate(node, "forget")}>
                              遗忘
                            </Button>
                          </>
                        }
                      >
                        <Button size="small" onClick={() => void saveEdit(node)}>
                          保存
                        </Button>
                        <Button size="small" variant="ghost" onClick={cancelEdit}>
                          取消
                        </Button>
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={editing()?.id === node.id}
                    fallback={<div class="mt-1 whitespace-pre-wrap text-13-regular text-text-base">{node.content}</div>}
                  >
                    <textarea
                      class="mt-1 min-h-24 w-full rounded border border-border-base bg-background-base p-2 text-13-regular text-text-base"
                      value={editing()?.text ?? ""}
                      onInput={(event) => setEditing({ id: node.id, text: event.currentTarget.value })}
                    />
                  </Show>
                  <div class="mt-1 text-11-regular text-text-weak">{node.id}</div>
                </div>
              )}
            </For>
          </Show>

          <Show when={tab() === "画像"}>
            <div class="mb-2 text-12-regular text-text-weak">用户维护的长期规则，作为可信画像注入。</div>
            <textarea
              class="min-h-64 w-full rounded border border-border-base bg-background-base p-3 text-13-regular text-text-base"
              value={profileText() || profile()?.current?.content || ""}
              onInput={(event) => setProfileText(event.currentTarget.value)}
            />
            <div class="mt-2 flex gap-2">
              <Button size="small" onClick={() => void saveProfile()}>
                保存画像
              </Button>
              <Button size="small" variant="ghost" onClick={() => void refreshProfile()}>
                刷新
              </Button>
            </div>
          </Show>

          <Show when={tab() === "整理"}>
            <div class="mb-3 flex gap-2">
              <Button size="small" onClick={() => void runReflect()}>
                立即整理
              </Button>
              <Button size="small" variant="ghost" onClick={() => void runDistill()}>
                立即蒸馏
              </Button>
              <Button size="small" variant="ghost" onClick={() => void refreshReflections()}>
                刷新
              </Button>
            </div>
            <For each={reflections() ?? []}>
              {(item) => (
                <div class="mb-2 rounded border border-border-base p-3">
                  <div class="text-12-regular text-text-weak">
                    [{item.scope}/{item.action}] {item.status} · {Math.round(item.confidence * 100)}%
                  </div>
                  <div class="mt-1 text-13-regular text-text-base">{item.content || item.reason || "无描述"}</div>
                  <div class="mt-1 text-11-regular text-text-weak">
                    {item.sourceIds.join(", ")}
                    {item.targetId ? ` -> ${item.targetId}` : ""}
                  </div>
                  <Show when={item.status === "pending"}>
                    <div class="mt-2 flex gap-1">
                      <Button size="small" onClick={() => void decideReflection(item, "accept")}>
                        接受
                      </Button>
                      <Button size="small" variant="ghost" onClick={() => void decideReflection(item, "reject")}>
                        拒绝
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>

          <Show when={tab() === "记录"}>
            <div class="mb-3 flex gap-2">
              <Button size="small" variant="ghost" onClick={() => void refreshAudit()}>
                刷新
              </Button>
            </div>
            <For each={audit() ?? []}>
              {(entry) => (
                <div class="mb-1 rounded border border-border-base px-3 py-2 text-12-regular">
                  <span class="text-text-weak">{new Date(entry.at).toLocaleString()} · {entry.scope} · {entry.op}</span>
                  <span class="ml-2 text-text-base">{entry.targetID}</span>
                </div>
              )}
            </For>
          </Show>

          <Show when={tab() === "运维"}>
            <div class="flex flex-col gap-3">
              <div class="text-12-regular text-text-weak">
                v3 记忆存储在本地 SQLite。备份会导出 user、shared 和所有 project 数据库。
              </div>
              <div class="flex flex-wrap gap-2">
                <Button size="small" onClick={() => void backup()}>
                  立即备份
                </Button>
                <Button size="small" variant="ghost" onClick={() => void exportJson()}>
                  导出 JSON
                </Button>
                <Button size="small" variant="ghost" onClick={() => void exportMarkdown()}>
                  导出 Markdown
                </Button>
                <Button size="small" variant="ghost" onClick={() => importRef?.click()}>
                  导入恢复
                </Button>
                <Button size="small" variant="ghost" onClick={() => void rebuild()}>
                  重建 embedding
                </Button>
                <Button size="small" variant="ghost" onClick={() => void refresh()}>
                  刷新
                </Button>
                <Button size="small" variant="secondary" onClick={() => void clearAll()}>
                  清空 v3 记忆
                </Button>
              </div>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                class="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ""
                  if (file) void importFile(file)
                }}
              />
              <div class="text-11-regular text-text-weak">
                导入只允许空库恢复；如果当前已有记忆，请先备份并清空，再导入。
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

function Metric(props: { label: string; value: number }) {
  return (
    <div class="rounded border border-border-base p-3">
      <div class="text-11-regular text-text-weak">{props.label}</div>
      <div class="text-20-medium text-text-strong">{props.value}</div>
    </div>
  )
}
