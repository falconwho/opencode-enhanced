import { describe, expect, test } from "bun:test"
import { isOverLineLimit } from "./message-collapse"

describe("isOverLineLimit", () => {
  test("does not collapse exactly ten lines", () => {
    expect(isOverLineLimit({ scrollHeight: 200, lineHeight: 20 })).toBe(false)
  })

  test("collapses content taller than ten lines", () => {
    expect(isOverLineLimit({ scrollHeight: 201, lineHeight: 20 })).toBe(true)
    expect(isOverLineLimit({ scrollHeight: 240, lineHeight: 20 })).toBe(true)
  })

  test("supports a custom limit", () => {
    expect(isOverLineLimit({ scrollHeight: 101, lineHeight: 20, limit: 5 })).toBe(true)
  })

  test("does not collapse when line height is unusable", () => {
    expect(isOverLineLimit({ scrollHeight: 400, lineHeight: 0 })).toBe(false)
    expect(isOverLineLimit({ scrollHeight: 400, lineHeight: Number.NaN })).toBe(false)
  })
})
