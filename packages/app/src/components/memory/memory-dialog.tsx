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
  rooms?: Array<{ room: string; count: number }>
}

type Node = {
  id: string
  scope: string
  kind: string
  content: string
  status: string
  slot?: { room: string; index: number }
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

const tabs = ["概览", "记忆库", "画像", "复习", "运维"] as const

export const MemoryDialog: Component<{ sessionID?: string; directory?: string }> = (props) => {
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const [tab, setTab] = createSignal<(typeof tabs)[number]>("概览")
  const [query, setQuery] = createSignal("")
  const [profileText, setProfileText] = createSignal("")
  const [loadError, setLoadError] = createSignal<string>()

  const request = async (path: string, init?: RequestInit) => {
    const http = serverSdk().server.http
    const params = new URLSearchParams()
    if (props.sessionID) params.set("sessionID", props.sessionID)
    if (props.directory) params.set("directory", props.directory)
    const separator = path.includes("?") ? "&" : "?"
    const url = new URL(`${path}${params.toString() ? separator + params.toString() : ""}`, http.url)
    const res = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(http.password
          ? { authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
          : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`memory request failed: ${res.status}`)
    return res.json()
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
  const [nodes, { refetch: refreshNodes }] = createResource<Node[]>(() => load("/memory/v3/nodes?limit=200", []))
  const [profile, { refetch: refreshProfile }] = createResource<Profile>(() => load("/memory/v3/profile", {}))
  const [review, { refetch: refreshReview }] = createResource<Node[]>(() => load("/memory/v3/review", []))
  const [search, setSearch] = createSignal<Hit[]>([])
  const [searching, setSearching] = createSignal(false)

  const refresh = () => {
    void refreshStats()
    void refreshNodes()
    void refreshProfile()
    void refreshReview()
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

  const mutate = async (node: Node, action: "archive" | "restore" | "forget") => {
    try {
      await request("/memory/v3/mutate", {
        method: "POST",
        body: JSON.stringify({ id: node.id, action }),
      })
      refresh()
    } catch (error) {
      showToast({ title: "记忆操作失败", description: error instanceof Error ? error.message : String(error) })
    }
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

  const clearAll = async () => {
    if (!confirm("确定清空所有 v3 记忆吗？旧 v2 备份不会被删除。")) return
    try {
      await request("/memory/v3/clear", { method: "POST", body: "{}" })
      refresh()
      showToast({ title: "记忆已清空" })
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
              <For each={stats()?.rooms ?? []}>
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
                      <Button size="small" variant="ghost" onClick={() => void mutate(node, "archive")}>
                        归档
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

          <Show when={tab() === "运维"}>
            <div class="flex flex-col gap-3">
              <div class="text-12-regular text-text-weak">
                v3 记忆存储在本地 SQLite。清空只删除 v3 数据，不会删除 v2 备份。
              </div>
              <div class="flex gap-2">
                <Button size="small" variant="ghost" onClick={refresh}>
                  刷新
                </Button>
                <Button size="small" variant="secondary" onClick={() => void clearAll()}>
                  清空 v3 记忆
                </Button>
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
