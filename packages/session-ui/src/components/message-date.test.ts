import { describe, expect, test } from "bun:test"
import { formatMessageDate } from "./message-date"

describe("formatMessageDate", () => {
  test("formats a local message timestamp as yyyy-mm-dd", () => {
    const created = new Date(2026, 10, 3, 21, 57).getTime()
    expect(formatMessageDate(created)).toBe("2026-11-03")
  })

  test("pads single-digit months and days", () => {
    const created = new Date(2026, 0, 5, 8, 4).getTime()
    expect(formatMessageDate(created)).toBe("2026-01-05")
  })

  test("returns an empty string without a valid timestamp", () => {
    expect(formatMessageDate()).toBe("")
    expect(formatMessageDate(Number.NaN)).toBe("")
  })
})
