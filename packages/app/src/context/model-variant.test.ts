import { describe, expect, test } from "bun:test"
import {
  cycleModelVariant,
  getConfiguredAgentVariant,
  resolveEffectiveVariant,
  resolveModelVariant,
} from "./model-variant"

describe("model variant", () => {
  test("resolves configured agent variant when model matches", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "openai",
        modelID: "gpt-5.2",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBe("xhigh")
  })

  test("ignores configured variant when model does not match", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBeUndefined()
  })

  test("prefers selected variant over configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: "high",
      configured: "xhigh",
    })

    expect(value).toBe("high")
  })

  test("lets an explicit default override the configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBeUndefined()
  })

  test("cycles from configured variant to next", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "high",
    })

    expect(value).toBe("xhigh")
  })

  test("wraps from configured last variant to first", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })

  test("cycles from an explicit default to the first variant", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })
})

describe("resolveEffectiveVariant", () => {
  test("keeps an explicit default even when a global fallback exists", () => {
    const value = resolveEffectiveVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "high",
      fallback: "xhigh",
      allowFallback: true,
    })

    expect(value).toBeUndefined()
  })

  test("does not read the global fallback for an existing session", () => {
    const value = resolveEffectiveVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: undefined,
      fallback: "xhigh",
      allowFallback: false,
    })

    expect(value).toBeUndefined()
  })

  test("uses the global fallback as the seed for a new session", () => {
    const value = resolveEffectiveVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: undefined,
      fallback: "xhigh",
      allowFallback: true,
    })

    expect(value).toBe("xhigh")
  })
})
