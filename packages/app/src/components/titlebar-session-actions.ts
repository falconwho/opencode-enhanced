import { createSignal, onCleanup, onMount } from "solid-js"

export function createTitlebarSessionActionsRegistry() {
  const [owner, setOwner] = createSignal<symbol>()

  return {
    claim(token: symbol) {
      setOwner(token)
    },
    release(token: symbol) {
      setOwner((current) => (current === token ? undefined : current))
    },
    active(token: symbol) {
      return owner() === token
    },
  }
}

export const titlebarSessionActions = createTitlebarSessionActionsRegistry()

export function useTitlebarSessionActions() {
  const token = Symbol("session-header-actions")

  onMount(() => {
    titlebarSessionActions.claim(token)
    onCleanup(() => titlebarSessionActions.release(token))
  })

  return () => titlebarSessionActions.active(token)
}
