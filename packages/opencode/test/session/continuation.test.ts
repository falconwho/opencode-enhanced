import { describe, expect, test } from "bun:test"

import { isContinuationPrompt } from "../../src/session/continuation"

const text = (value: string) => [{ type: "text" as const, text: value }]

describe("isContinuationPrompt", () => {
  test("accepts explicit continuation commands", () => {
    for (const value of ["继续", " 继续！", "接着做。", "Continue", "resume.", "go on", "keep going!"]) {
      expect(isContinuationPrompt(text(value))).toBe(true)
    }
  })

  test("treats continuation with extra task content as a new task", () => {
    for (const value of ["继续做一个新功能", "继续，修复登录问题", "continue with a new feature", "继续 work on X"]) {
      expect(isContinuationPrompt(text(value))).toBe(false)
    }
  })

  test("rejects empty and non-text prompts", () => {
    expect(isContinuationPrompt([])).toBe(false)
    expect(isContinuationPrompt([{ type: "text", text: "   " }])).toBe(false)
    expect(isContinuationPrompt([{ type: "file" }])).toBe(false)
    expect(isContinuationPrompt([{ type: "text", text: "继续" }, { type: "file" }])).toBe(false)
  })
})
