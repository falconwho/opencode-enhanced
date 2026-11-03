import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveActiveAgent, resolveAgent } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasCustomAgent([{ native: true }, {}])).toBe(false)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses the requested available agent", () => {
    expect(resolveAgent(agents, "custom")?.name).toBe("custom")
  })

  test("defaults to build", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
  })

  test("uses the first agent when build is unavailable", () => {
    expect(resolveAgent([{ name: "custom" }], "missing")?.name).toBe("custom")
  })
})

describe("resolveActiveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses build for a session without its own agent or fallback", () => {
    expect(resolveActiveAgent(agents, undefined)?.name).toBe("build")
  })

  test("keeps an explicitly selected session agent", () => {
    expect(resolveActiveAgent(agents, "plan", "build")?.name).toBe("plan")
  })

  test("uses the session fallback when local selection is missing", () => {
    expect(resolveActiveAgent(agents, undefined, "plan")?.name).toBe("plan")
  })

  test("uses build when the session fallback is unavailable", () => {
    expect(resolveActiveAgent(agents, undefined, "missing")?.name).toBe("build")
  })
})
