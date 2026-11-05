import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { MemoryContext } from "../../src/session/memory-context"

const user = (id: string, text: string): SessionV1.WithParts => ({
  info: {
    id,
    sessionID: "ses_test",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "opencode", modelID: "test" },
  } as SessionV1.User,
  parts: [
    {
      id: `${id}_part`,
      sessionID: "ses_test",
      messageID: id,
      type: "text",
      text,
    } as SessionV1.TextPart,
  ],
})

const compactionUser = (id: string, tail: string): SessionV1.WithParts => ({
  info: {
    id,
    sessionID: "ses_test",
    role: "user",
    time: { created: 2 },
    agent: "build",
    model: { providerID: "opencode", modelID: "test" },
  } as SessionV1.User,
  parts: [
    {
      id: `${id}_part`,
      sessionID: "ses_test",
      messageID: id,
      type: "compaction",
      auto: true,
      tail_start_id: tail,
    } as SessionV1.CompactionPart,
  ],
})

const summary = (id: string, parentID: string): SessionV1.WithParts => ({
  info: {
    id,
    sessionID: "ses_test",
    role: "assistant",
    time: { created: 3 },
    parentID,
    modelID: "test",
    providerID: "opencode",
    mode: "compaction",
    agent: "compaction",
    path: { cwd: "/tmp", root: "/tmp" },
    summary: true,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "end_turn",
  } as SessionV1.Assistant,
  parts: [
    {
      id: `${id}_part`,
      sessionID: "ses_test",
      messageID: id,
      type: "text",
      text: "summary",
    } as SessionV1.TextPart,
  ],
})

const memory = (
  id: string,
  text: string,
  at: number,
  input?: { kind?: "memory-packet" | "memory-delta"; head?: boolean },
): SessionV1.WithParts => ({
  info: {
    id,
    sessionID: "ses_test",
    role: "user",
    synthetic: true,
    time: { created: at },
    agent: "build",
    model: { providerID: "opencode", modelID: "test" },
  } as SessionV1.User,
  parts: [
    {
      id: `${id}_part`,
      sessionID: "ses_test",
      messageID: id,
      type: "text",
      text,
      synthetic: true,
      metadata: {
        "opencode-enhanced": {
          kind: input?.kind ?? "memory-packet",
          hash: `hash-${id}`,
          at,
          ...(input?.head ? { head: true } : {}),
        },
      },
    } as unknown as SessionV1.TextPart,
  ],
})

const harness = (messages: SessionV1.WithParts[], context: { text: string; hash: string }) => {
  const written: Array<SessionV1.Info | SessionV1.Part> = []
  let deltaCalls = 0
  const sessions = {
    updateMessage: (value: SessionV1.Info) => Effect.sync(() => (written.push(value), value)),
    updatePart: (value: SessionV1.Part) => Effect.sync(() => (written.push(value), value)),
  }
  const memory = {
    enabled: () => Effect.succeed(true),
    context: () => Effect.succeed({ ...context, profile: "", memory: context.text }),
    delta: () =>
      Effect.sync(() => {
        deltaCalls += 1
        return "should-not-be-used"
      }),
  }
  return {
    input: {
      messages,
      session: { id: "ses_test", projectID: "proj", directory: "/tmp" } as never,
      agent: { name: "build" },
      sessions: sessions as never,
      memory: memory as never,
      now: 10,
    },
    written,
    deltaCalls: () => deltaCalls,
  }
}

const memoryMessages = (messages: SessionV1.WithParts[]) =>
  messages.filter((message) =>
    message.parts.some((part) => {
      if (part.type !== "text") return false
      const marker = (part.metadata as Record<string, unknown> | undefined)?.["opencode-enhanced"] as
        | { kind?: string }
        | undefined
      return marker?.kind === "memory-packet" || marker?.kind === "memory-delta"
    }),
  )

describe("memory context injection", () => {
  test("appends one packet then only deltas", async () => {
    const messages = [user("msg_1", "hello")]
    const { input, written } = harness(messages, { text: "packet", hash: "packet-hash" })
    await Effect.runPromise(MemoryContext.apply(input))
    expect(messages.length).toBe(2)
    expect(written.length).toBe(2)
    expect((messages.at(-1)?.info as { synthetic?: boolean }).synthetic).toBe(true)
    await Effect.runPromise(MemoryContext.apply(input))
    expect(messages.length).toBe(3)
    expect(written.length).toBe(4)
    await Effect.runPromise(MemoryContext.apply(input))
    expect(messages.length).toBe(3)
    expect(written.length).toBe(4)
  })

  test("rebuilds a single head packet after compaction", async () => {
    const messages = [
      compactionUser("msg_comp", "msg_tail"),
      summary("msg_sum", "msg_comp"),
      user("msg_tail", "tail"),
      memory("msg_old", "old packet", 2),
      memory("msg_delta", "old delta", 4, { kind: "memory-delta" }),
    ]
    const { input, written } = harness(messages, { text: "fresh packet", hash: "fresh-hash" })

    const result = await Effect.runPromise(MemoryContext.apply(input))

    expect(result[0]?.parts[0]?.type).toBe("text")
    expect((result[0]?.info as { synthetic?: boolean }).synthetic).toBe(true)
    expect(
      ((result[0]?.parts[0] as SessionV1.TextPart).metadata as Record<string, unknown>)["opencode-enhanced"],
    ).toMatchObject({
      kind: "memory-packet",
      hash: "fresh-hash",
      head: true,
    })
    expect((result[1]?.info as { id: string }).id).toBe("msg_comp")
    expect(memoryMessages(result).length).toBe(1)
    expect(written.filter((item) => "role" in item).length).toBe(1)
  })

  test("does not append deltas after compaction", async () => {
    const messages = [
      compactionUser("msg_comp", "msg_tail"),
      summary("msg_sum", "msg_comp"),
      user("msg_tail", "tail"),
      memory("msg_old", "old packet", 2),
    ]
    const { input, deltaCalls } = harness(messages, { text: "fresh packet", hash: "fresh-hash" })

    const result = await Effect.runPromise(MemoryContext.apply(input))

    expect(deltaCalls()).toBe(0)
    expect(memoryMessages(result).length).toBe(1)
  })

  test("rebuilds the head after a later compaction instead of reusing an older one", async () => {
    const messages = [
      compactionUser("msg_comp", "msg_tail"),
      summary("msg_sum", "msg_comp"),
      user("msg_tail", "tail"),
      memory("msg_head", "old head", 1, { head: true }),
    ]
    const { input } = harness(messages, { text: "fresh packet", hash: "fresh-hash" })

    const result = await Effect.runPromise(MemoryContext.apply(input))

    expect((result[0]?.info as { id: string }).id).not.toBe("msg_head")
    expect(memoryMessages(result).length).toBe(1)
    expect(
      ((result[0]?.parts[0] as SessionV1.TextPart).metadata as Record<string, unknown>)["opencode-enhanced"],
    ).toMatchObject({
      kind: "memory-packet",
      hash: "fresh-hash",
      head: true,
    })
  })

  test("updates the same head packet when memory changes", async () => {
    const messages = [
      compactionUser("msg_comp", "msg_tail"),
      summary("msg_sum", "msg_comp"),
      user("msg_tail", "tail"),
      memory("msg_head", "old head", 5, { head: true }),
    ]
    const { input, written } = harness(messages, { text: "fresh packet", hash: "fresh-hash" })

    const first = await Effect.runPromise(MemoryContext.apply(input))
    expect((first[0]?.info as { id: string }).id).toBe("msg_head")
    expect((first[0]?.parts[0] as SessionV1.TextPart).text).toBe("fresh packet")
    expect(written.length).toBe(1)

    input.memory = {
      enabled: () => Effect.succeed(true),
      context: () => Effect.succeed({ text: "next packet", hash: "next-hash", profile: "", memory: "next packet" }),
      delta: () => Effect.succeed("unused"),
    } as never
    const second = await Effect.runPromise(MemoryContext.apply(input))
    expect((second[0]?.info as { id: string }).id).toBe("msg_head")
    expect((second[0]?.parts[0] as SessionV1.TextPart).text).toBe("next packet")
    expect(written.length).toBe(2)
    expect(String(written.at(-1)?.id)).toBe("msg_head_part")
  })
})
