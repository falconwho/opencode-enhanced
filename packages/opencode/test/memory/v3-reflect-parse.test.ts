import { describe, expect, test } from "bun:test"
import { parseReflection } from "../../src/memory/v3/service"

describe("memory v3 reflection parser", () => {
  test("parses valid suggestions and clamps confidence", () => {
    const result = parseReflection(
      '```json\n{"suggestions":[{"action":"merge","sourceIds":["a","b"],"targetId":"a","content":"merged","reason":"duplicate","confidence":1.4}]}\n```',
    )
    expect(result).toEqual([
      {
        action: "merge",
        scope: undefined,
        sourceIds: ["a", "b"],
        targetId: "a",
        content: "merged",
        reason: "duplicate",
        confidence: 1,
      },
    ])
  })

  test("drops malformed suggestions and invalid actions", () => {
    expect(parseReflection('{"suggestions":[{"action":"delete","sourceIds":["a"]},{"action":"link","sourceIds":[]}]}')).toEqual([])
    expect(parseReflection("not json")).toEqual([])
  })
})
