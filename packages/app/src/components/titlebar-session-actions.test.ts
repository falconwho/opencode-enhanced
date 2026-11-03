import { describe, expect, test } from "bun:test"
import { createTitlebarSessionActionsRegistry } from "./titlebar-session-actions"

describe("titlebar session actions registry", () => {
  test("keeps only the latest owner active", () => {
    const registry = createTitlebarSessionActionsRegistry()
    const first = Symbol("first")
    const second = Symbol("second")

    registry.claim(first)
    expect(registry.active(first)).toBe(true)

    registry.claim(second)
    expect(registry.active(first)).toBe(false)
    expect(registry.active(second)).toBe(true)
  })

  test("release only clears the active owner", () => {
    const registry = createTitlebarSessionActionsRegistry()
    const first = Symbol("first")
    const second = Symbol("second")

    registry.claim(first)
    registry.claim(second)
    registry.release(first)

    expect(registry.active(second)).toBe(true)

    registry.release(second)
    expect(registry.active(second)).toBe(false)
  })
})
