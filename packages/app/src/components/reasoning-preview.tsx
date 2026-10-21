import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"

// opencode-enhanced F7: always-on reasoning preview.
// Shows the last 5 lines of the streaming reasoning part underneath the
// "thinking..." row inside the conversation history, regardless of the "show
// reasoning summaries" setting. Auto-collapses when the assistant starts
// writing the main text; manual toggle available.
export function ReasoningPreview(props: { sessionID?: string }) {
  const sync = useSync()
  const language = useLanguage()
  const [collapsed, setCollapsed] = createSignal(false)
  const [pinned, setPinned] = createSignal(false)
  const [messageID, setMessageID] = createSignal<string>()
  const [stickToBottom, setStickToBottom] = createSignal(true)
  let previewRef: HTMLPreElement | undefined
  let scrollFrame: number | undefined

  const lastAssistant = createMemo(() => {
    const id = props.sessionID
    if (!id) return
    const messages = sync().data.message[id] ?? []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message?.role === "assistant") return message
    }
  })

  const parts = createMemo(() => {
    const message = lastAssistant()
    if (!message) return []
    return sync().data.part[message.id] ?? []
  })

  const reasoning = createMemo(() =>
    parts()
      .filter((part) => part.type === "reasoning")
      .map((part) => ("text" in part ? ((part.text as string) ?? "") : ""))
      .join("\n"),
  )

  const hasText = createMemo(() =>
    parts().some((part) => part.type === "text" && "text" in part && ((part.text as string) ?? "").trim().length > 0),
  )

  const busy = createMemo(() => sync().data.session_working(props.sessionID ?? ""))

  createEffect(() => {
    const id = lastAssistant()?.id
    if (!id || id === messageID()) return
    setMessageID(id)
    setPinned(false)
    setCollapsed(false)
    setStickToBottom(true)
  })

  createEffect(() => {
    if (!hasText() || pinned()) return
    setCollapsed(true)
  })

  const lines = createMemo(() =>
    reasoning()
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-5),
  )

  const scheduleScroll = () => {
    if (scrollFrame !== undefined) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      if (previewRef) previewRef.scrollTop = previewRef.scrollHeight
    })
  }

  createEffect(() => {
    reasoning()
    if (collapsed() || !stickToBottom()) return
    scheduleScroll()
  })

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
  })

  const active = createMemo(() => busy() && reasoning().trim().length > 0)

  return (
    <Show when={active()}>
      <div
        data-component="reasoning-preview"
        class="mt-2 w-full rounded-md border border-border-weak-base bg-background-base"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 px-2 py-1 text-12-regular text-text-weak hover:text-text-base"
          onClick={() => {
            const next = !collapsed()
            setCollapsed(next)
            setPinned(!next)
            if (!next) setStickToBottom(true)
          }}
        >
          <Icon name="brain" size="small" />
          <span class="flex-1 text-left">{language.t("prompt.reasoningPreview.title")}</span>
          <Icon name={collapsed() ? "expand" : "collapse"} size="small" />
        </button>
        <Show when={!collapsed()}>
          <pre
            ref={previewRef}
            class="max-h-[120px] overflow-y-auto whitespace-pre-wrap px-3 pb-2 font-mono text-12-regular text-text-weak"
            onScroll={(event) => {
              const element = event.currentTarget
              setStickToBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 8)
            }}
          >
            {lines().join("\n")}
          </pre>
        </Show>
      </div>
    </Show>
  )
}
