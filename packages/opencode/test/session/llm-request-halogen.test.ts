import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMRequestPrep } from "@/session/llm/request"
import { ProviderTransform } from "@/provider/transform"

const sessionID = "ses_halogen_cache_test"

const model = {
  id: "halogen-qwen3.8-flash-next",
  providerID: "halogen",
  api: {
    id: "halogen-qwen3.8-flash-next",
    url: "http://127.0.0.1:8731/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Halogen Qwen",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: {
    context: 262_144,
    output: 32_000,
  },
  status: "active",
  options: {},
  headers: {},
} as any

const input = (overrides: Record<string, unknown> = {}) =>
  ({
    user: {
      id: "msg_halogen_cache_test",
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "halogen", modelID: "halogen-qwen3.8-flash-next" },
    },
    sessionID,
    model,
    agent: {
      name: "build",
      mode: "primary",
      options: {},
      permission: [],
    },
    system: [],
    messages: [{ role: "user", content: "hello" }],
    tools: {},
    provider: { id: "halogen", options: {} },
    auth: undefined,
    plugin: {
      trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
      list: () => Effect.succeed([]),
      init: () => Effect.void,
    },
    flags: { outputTokenMax: 32_000, client: "test" },
    isWorkflow: false,
    ...overrides,
  }) as any

const prepare = (overrides: Record<string, unknown> = {}) =>
  Effect.runPromise(LLMRequestPrep.prepare(input(overrides)))

const header = (result: any, name: string) => (result.headers as Record<string, string>)[name]

describe("Halogen prompt cache policy", () => {
  test("marks small side requests as no_store", async () => {
    const result = await prepare({ small: true })

    expect(result.params.options.prompt_cache_policy).toBe("no_store")
    expect(header(result, "X-Halogen-Keep")).toBeUndefined()
    expect(header(result, "X-Halogen-From")).toBeUndefined()
  })

  test("keeps the first root turn without a from header", async () => {
    const result = await prepare()

    expect(header(result, "X-Halogen-Keep")).toBe(`opencode-${sessionID}`)
    expect(header(result, "X-Halogen-From")).toBeUndefined()
    expect(result.params.options.prompt_cache_policy).toBeUndefined()
  })

  test("resumes later root turns with keep and from headers", async () => {
    const result = await prepare({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" },
      ],
    })

    expect(header(result, "X-Halogen-Keep")).toBe(`opencode-${sessionID}`)
    expect(header(result, "X-Halogen-From")).toBe(`opencode-${sessionID}`)
  })

  test("marks explicit noStore requests as no_store", async () => {
    const result = await prepare({ noStore: true })

    expect(result.params.options.prompt_cache_policy).toBe("no_store")
    expect(header(result, "X-Halogen-Keep")).toBeUndefined()
    expect(header(result, "X-Halogen-From")).toBeUndefined()
  })

  test("does not keep child sessions", async () => {
    const result = await prepare({ parentSessionID: "ses_parent" })

    expect(header(result, "X-Halogen-Keep")).toBeUndefined()
    expect(header(result, "X-Halogen-From")).toBeUndefined()
  })

  test("does not add Halogen controls for other providers", async () => {
    const result = await prepare({
      model: {
        ...model,
        providerID: "other",
        api: { ...model.api, npm: "@ai-sdk/openai-compatible" },
      },
      provider: { id: "other", options: {} },
    })

    expect(result.params.options.prompt_cache_policy).toBeUndefined()
    expect(header(result, "X-Halogen-Keep")).toBeUndefined()
    expect(header(result, "X-Halogen-From")).toBeUndefined()
  })

  test("forwards the policy under the Halogen provider key", () => {
    expect(ProviderTransform.providerOptions(model, { prompt_cache_policy: "no_store" })).toEqual({
      halogen: { prompt_cache_policy: "no_store" },
    })
  })
})

