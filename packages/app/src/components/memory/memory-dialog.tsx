import { Component, For, Show, createResource, createSignal } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { useServerSDK } from "@/context/server-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { authTokenFromCredentials } from "@/utils/server"
import { showToast } from "@/utils/toast"

type Stats = {
  total?: number
  active?: number
  archived?: number
  due?: number
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

type Hit = {
  node: Node
  score: number
  ref: string
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

const tabs = ["概览", "记忆库", "画像", "复习", "巩固", "审计", "运维"] as const

export const MemoryDialog: Component<{ sessionID?: string; directory?: string }> = (props) => {
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const [tab, setTab] = createSignal<(typeof tabs)[number]>("概览")
  const [query, setQuery] = createSignal("")
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
  const [review, { refetch: refreshReview }] = createResource<Node[]>(() => load("/memory/v3/review", []))
  const [reflections, { refetch: refreshReflections }] = createResource<Reflection[]>(() =>
    load("/memory/v3/reflect", []),
  )
  const [audit, { refetch: refreshAudit }] = createResource<AuditEntry[]>(() => load("/memory/v3/audit?limit=100", []))
  const [search, setSearch] = createSignal<Hit[]>([])
  const [searching, setSearching] = createSignal(false)

  const refresh = () => {
    void refreshStats()
    void refreshRooms()
    void refreshNodes()
    void refreshProfile()
    void refreshReview()
    void refreshReflections()
    void refreshAudit()
  }

  const runSearch = async () => {
    if (!query().trim()) return
    setSearching(true)
    try {
      const result = (await request(`/memory/v3/search?query=${encodeURIComponent(query())}`)) as { hits?: Hit[] }
      setSearch(result.hits ?? [])
    } catch (error) {
      showToast({ title: "记忆搜索失败", description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSearching(false)
    }
  }

  const mutate = async (node: Node, action: "update" | "archive" | "restore" | "forget", content?: string) => {
    try {
      await request("/memory/v3/mutate", {
        method: "POST",
        body: JSON.stringify({ id: node.id, action, content }),
      })
      refresh()
    } catch (error) {
      showToast({ title: "记忆操作失败", description: error instanceof Error ? error.message : String(error) })
    }
  }

  const edit = (node: Node) => {
    const content = window.prompt("编辑记忆内容", node.content)
    if (content === null || !content.trim() || content === node.content) return
    void mutate(node, "update", content.trim())
  }

  const grade = async (node: Node, value: number) => {
    try {
      await request("/memory/v3/review", {
        method: "POST",
        body: JSON.stringify({ id: node.id, grade: value }),
      })
      void refreshReview()
    } catch (error) {
      showToast({ title: "复习评分失败", description: error instanceof Error ? error.message : String(error) })
    }
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
      showToast({ title: `巩固完成：新增 ${result.created ?? 0} 条建议` })
    } catch (error) {
      showToast({ title: "巩固失败", description: error instanceof Error ? error.message : String(error) })
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
      showToast({ title: "巩固操作失败", description: error instanceof Error ? error.message : String(error) })
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
              <Metric label="待复习" value={stats()?.due ?? 0} />
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
            <div class="mb-3 flex gap-2">
              <TextField value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="搜索记忆" />
              <Button size="small" onClick={() => void runSearch()} disabled={searching()}>
                搜索
              </Button>
            </div>
            <For each={search().length ? search().map((hit) => hit.node) : (nodes() ?? [])}>
              {(node) => (
                <div class="mb-2 rounded border border-border-base p-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-regular text-text-weak">
                      [{node.scope}/{node.kind}] {node.status}
                      {node.slot ? ` · ${node.slot.room}#${node.slot.index}` : ""}
                    </div>
                    <div class="flex gap-1">
                      <Button size="small" variant="ghost" onClick={() => edit(node)}>
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
                    </div>
                  </div>
                  <div class="mt-1 whitespace-pre-wrap text-13-regular text-text-base">{node.content}</div>
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

          <Show when={tab() === "复习"}>
            <For each={review() ?? []}>
              {(node) => (
                <div class="mb-2 rounded border border-border-base p-3">
                  <div class="text-12-regular text-text-weak">
                    {node.slot ? `${node.slot.room}#${node.slot.index}` : "未排桩"} · {node.kind}
                  </div>
                  <div class="mt-1 text-13-regular text-text-base">{node.content}</div>
                  <div class="mt-2 flex gap-1">
                    <For each={[0, 3, 4, 5]}>
                      {(value) => (
                        <Button size="small" variant="ghost" onClick={() => void grade(node, value)}>
                          {value}
                        </Button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>

          <Show when={tab() === "巩固"}>
            <div class="mb-3 flex gap-2">
              <Button size="small" onClick={() => void runReflect()}>
                立即巩固
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

          <Show when={tab() === "审计"}>
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
