import { describe, expect, test } from "bun:test"
import { shouldStartAtBottom } from "./session-enter-scroll"

describe("shouldStartAtBottom", () => {
  test("starts at the bottom for a normal session entry", () => {
    expect(shouldStartAtBottom({})).toBe(true)
  })

  test("preserves explicit message targets", () => {
    expect(shouldStartAtBottom({ hash: "#msg_1" })).toBe(false)
    expect(shouldStartAtBottom({ pendingMessage: "msg_1" })).toBe(false)
    expect(shouldStartAtBottom({ messageId: "msg_1" })).toBe(false)
  })
})
