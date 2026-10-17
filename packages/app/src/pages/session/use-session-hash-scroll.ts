import type { UserMessage } from "@opencode-ai/sdk/v2"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { messageIdFromHash } from "./message-id-from-hash"

export const useSessionHashScroll = (input: {
  sessionKey: () => string
  sessionID: () => string | undefined
  messagesReady: () => boolean
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  currentMessageId: () => string | undefined
  pendingMessage: () => string | undefined
  setPendingMessage: (value: string | undefined) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  autoScroll: { pause: () => void; forceScrollToBottom: () => void }
  scroller: () => HTMLDivElement | undefined
  anchor: (id: string) => string
  revealMessage?: (id: string) => void
  scheduleScrollState: (el: HTMLDivElement) => void
  consumePendingMessage: (key: string) => string | undefined
}) => {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  let pendingKey = ""
  let clearing = false

  const location = useLocation()
  const navigate = useNavigate()

  const frames = new Set<number>()
  const queue = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      fn()
    })
    frames.add(id)
  }
  const cancel = () => {
    for (const id of frames) cancelAnimationFrame(id)
    frames.clear()
  }

  const clearMessageHash = () => {
    cancel()
    input.consumePendingMessage(input.sessionKey())
    if (input.pendingMessage()) input.setPendingMessage(undefined)
    if (!location.hash) return
    clearing = true
    navigate(location.pathname + location.search, { replace: true })
  }

  const updateHash = (id: string) => {
    const hash = `#${input.anchor(id)}`
    if (location.hash === hash) return
    clearing = false
    navigate(location.pathname + location.search + hash, {
      replace: true,
    })
  }

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior) => {
    const root = input.scroller()
    if (!root) return false

    // opencode-enhanced F6: wait two frames for the layout to settle (the
    // target may have just been revealed by the virtualizer) so the offset
    // math never runs against stale rects - that made the first click land
    // flush at the top and only the second click reach the middle.
    queue(() => {
      queue(() => {
        const a = el.getBoundingClientRect()
        const b = root.getBoundingClientRect()

        // opencode-enhanced F6: if the target is already comfortably in view
        // (fully visible and below the top 15% band - the reveal hook may have
        // parked it flush at the top), do not scroll at all - jumping to a
        // message that is on screen must not shift the surrounding controls.
        if (a.top >= b.top && a.bottom <= b.bottom && a.top - b.top > b.height * 0.15) return

        const sticky = root.querySelector("[data-session-title]")
        const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
        // opencode-enhanced F6: land the target in the lower-middle of the viewport
        // (not flush at the top) so jumping to the last message never makes the
        // whole panel appear shifted up.
        const offset = Math.min(Math.max((root.clientHeight - inset) * 0.35, 120), 400)
        const top = Math.max(0, a.top - b.top + root.scrollTop - inset - offset)
        root.scrollTo({ top, behavior })
      })
    })
    return true
  }

  // opencode-enhanced F6: deterministic jump used by the quick navigator.
  // Unlike scrollToMessage it never touches the URL hash (no applyHash echo).
  // The reveal hook may asynchronously scroll the target flush to the top of
  // the viewport, so after the initial placement we keep correcting every
  // frame until the target rests in the lower-middle (or the reveal settles).
  // The browser clamps out-of-range tops, so jumping to the last message
  // naturally stops at the bottom without shifting controls.
  const jumpToMessage = (message: UserMessage) => {
    cancel()
    input.autoScroll.pause()
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)
    input.revealMessage?.(message.id)

    const place = (el: HTMLElement, root: HTMLDivElement, attempts: number) => {
      const a = el.getBoundingClientRect()
      const b = root.getBoundingClientRect()
      // Comfortably in view (below the top 15% band) -> nothing to do.
      if (a.top >= b.top && a.bottom <= b.bottom && a.top - b.top > b.height * 0.15) return
      if (attempts <= 0) return
      const sticky = root.querySelector("[data-session-title]")
      const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
      const offset = Math.min(Math.max((root.clientHeight - inset) * 0.4, 160), 500)
      const top = Math.max(0, a.top - b.top + root.scrollTop - inset - offset)
      root.scrollTop = top
      queue(() => place(el, root, attempts - 1))
    }

    const retry = (left: number) => {
      // Navigate by data-message-id, not the anchor id: user messages with
      // inline comments have anchor=false and therefore no id element.
      const el = document.querySelector(`[data-timeline-row="UserMessage"][data-message-id="${message.id}"]`)
      const root = input.scroller()
      if (!el || !root) {
        if (left <= 0) return
        queue(() => retry(left - 1))
        return
      }
      queue(() => {
        queue(() => place(el as HTMLElement, root, 20))
      })
    }
    retry(4)
  }

  const seek = (id: string, behavior: ScrollBehavior, left = 4): boolean => {
    input.revealMessage?.(id)
    const el = document.getElementById(input.anchor(id))
    if (el) return scrollToElement(el, behavior)
    if (left <= 0) return false
    queue(() => {
      seek(id, behavior, left - 1)
    })
    return false
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    cancel()
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)
    input.revealMessage?.(message.id)

    if (seek(message.id, behavior)) {
      updateHash(message.id)
      return
    }

    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const hash = location.hash.slice(1)
    if (!hash) {
      input.autoScroll.forceScrollToBottom()
      const el = input.scroller()
      if (el) input.scheduleScrollState(el)
      return
    }

    const messageId = messageIdFromHash(hash)
    if (messageId) {
      input.autoScroll.pause()
      const msg = messageById().get(messageId)
      if (msg) {
        scrollToMessage(msg, behavior)
        return
      }
      return
    }

    const target = document.getElementById(hash)
    if (target) {
      input.autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

    input.autoScroll.forceScrollToBottom()
    const el = input.scroller()
    if (el) input.scheduleScrollState(el)
  }

  createEffect(() => {
    const hash = location.hash
    if (!hash) clearing = false
    if (!input.sessionID() || !input.messagesReady()) return
    cancel()
    queue(() => applyHash("auto"))
  })

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId) {
      const key = input.sessionKey()
      if (pendingKey !== key) {
        pendingKey = key
        const next = input.consumePendingMessage(key)
        if (next) {
          input.setPendingMessage(next)
          targetId = next
        }
      }
    }

    if (!targetId && !clearing) targetId = messageIdFromHash(location.hash)
    if (!targetId) return

    const pending = input.pendingMessage() === targetId
    const msg = messageById().get(targetId)
    if (!msg) return

    if (pending) input.setPendingMessage(undefined)
    if (input.currentMessageId() === targetId && !pending) return

    input.autoScroll.pause()
    cancel()
    queue(() => scrollToMessage(msg, "auto"))
  })

  createEffect(() => {
    const sessionID = input.sessionID()
    if (!sessionID || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId && !clearing) targetId = messageIdFromHash(location.hash)
    if (!targetId) return
    if (messageById().has(targetId)) return
    if (!input.historyMore() || input.historyLoading()) return

    void input.loadMore(sessionID)
  })

  onMount(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual"
    }
  })

  onCleanup(cancel)

  return {
    clearMessageHash,
    scrollToMessage,
    jumpToMessage,
    applyHash,
  }
}
