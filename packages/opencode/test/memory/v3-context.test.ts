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

describe("memory context injection", () => {
  test("appends one packet then only deltas", async () => {
    const messages = [user("msg_1", "hello")]
    const written: Array<SessionV1.Info | SessionV1.Part> = []
    const sessions = {
      updateMessage: (value: SessionV1.Info) => Effect.sync(() => (written.push(value), value)),
      updatePart: (value: SessionV1.Part) => Effect.sync(() => (written.push(value), value)),
    }
    let contextCalls = 0
    const memory = {
      enabled: () => Effect.succeed(true),
      context: () =>
        Effect.sync(() => {
          contextCalls += 1
          return { text: "packet", hash: "packet-hash", profile: "", memory: "packet" }
        }),
      delta: () => Effect.succeed("delta"),
    }
    const input = {
      messages,
      session: { id: "ses_test", projectID: "proj", directory: "/tmp" } as never,
      agent: { name: "build" },
      sessions: sessions as never,
      memory: memory as never,
    }
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
})
