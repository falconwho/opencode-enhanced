import { describe, expect, test } from "bun:test"
import { appRelease } from "./app-release"

describe("app release label", () => {
  test("formats the current release into two lines", () => {
    expect(appRelease("1.18.35", "v1.18.35-enhanced.1.15.4")).toEqual({
      name: "v1.18.35 OpenCode Enhanced",
      enhanced: "1.15.4",
    })
  })

  test("falls back to the packaged enhanced release", () => {
    expect(appRelease("1.18.35", undefined)).toEqual({
      name: "v1.18.35 OpenCode Enhanced",
      enhanced: "1.15.4",
    })
  })

  test("ignores malformed release markers", () => {
    expect(appRelease("v1.18.35", "not-a-release")).toEqual({
      name: "v1.18.35 OpenCode Enhanced",
      enhanced: "1.15.4",
    })
  })
})
