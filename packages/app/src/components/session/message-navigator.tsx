import { createMemo, For, Show } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"

// opencode-enhanced F6: floating quick navigator for the user's own messages.
// Sits at the left edge of the conversation; hover previews a message, click
// smooth-scrolls to it (via the timeline's virtualizer scrollToIndex when
// available, so the rest of the layout never moves) and briefly highlights.
export function SessionMessageNavigator(props: { sessionID?: string; onJump?: (messageID: string) => void }) {
  const sync = useSync()
  const language = useLanguage()

  const items = createMemo(() => {
    const id = props.sessionID
    if (!id) return []
    return (sync().data.message[id] ?? [])
      .filter((message) => message.role === "user")
      .slice()
      .sort((a, b) => a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((message) => {
        const text = (sync().data.part[message.id] ?? [])
          .filter((part) => part.type === "text" && !part.synthetic)
          .map((part) => ("text" in part ? ((part.text as string) ?? "") : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
        return { id: message.id, label: text.slice(0, 40) || "…", preview: text.slice(0, 300) || "…" }
      })
  })

  const jump = (id: string) => {
    props.onJump?.(id)
    const el = document.querySelector(`[data-message-id="${id}"]`)
    if (!(el instanceof HTMLElement)) return
    el.style.transition = "box-shadow 0.3s ease"
    el.style.boxShadow = "0 0 0 2px var(--border-information-base, #3b82f6)"
    setTimeout(() => {
      el.style.boxShadow = ""
    }, 1600)
  }

  return (
    <Show when={items().length > 0}>
      <div
        data-component="session-message-navigator"
        class="absolute left-1 top-1/2 z-10 hidden max-h-[60%] w-[150px] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-md border border-border-weak-base bg-background-base/95 p-1.5 shadow-md lg:flex"
      >
        <div class="px-1 pb-1 text-11-regular text-text-weak">{language.t("session.messageNavigator.title")}</div>
        <For each={items()}>
          {(item, index) => (
            <Tooltip placement="right" gutter={6} value={item.preview} openDelay={0}>
              <button
                type="button"
                data-id={item.id}
                class="w-full truncate rounded px-1.5 py-0.5 text-left text-11-regular text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base"
                onClick={() => jump(item.id)}
              >
                {index() + 1}. {item.label}
              </button>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}
