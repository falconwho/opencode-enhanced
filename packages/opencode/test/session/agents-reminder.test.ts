import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"

import {
  AGENTS_REMINDER_METADATA_KEY,
  AgentsReminder,
  agentsReminderThresholds,
  contextTokens,
  dueThresholds,
} from "../../src/session/agents-reminder"
import { isSyntheticUserMessage } from "../../src/session/synthetic-message"
import { MessageV2 } from "../../src/session/message-v2"

const tokens = (used: number) => ({
  input: used,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

function userMessage(id = "msg_user", sessionID = "ses_test") {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [
      {
        id: `${id}_part`,
        messageID: id,
        sessionID,
        type: "text",
        text: "real user input",
      },
    ],
  } as unknown as SessionV1.WithParts
}

function assistantMessage(used: number, id = "msg_assistant") {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 2 },
      tokens: tokens(used),
    },
    parts: [],
  } as unknown as SessionV1.WithParts
}

function harness() {
  const messages: SessionV1.User[] = []
  const parts: SessionV1.Part[] = []
  const sessions = {
    updateMessage: (message: SessionV1.User) =>
      Effect.sync(() => {
        messages.push(message)
      }),
    updatePart: (part: SessionV1.Part) =>
      Effect.sync(() => {
        parts.push(part)
      }),
  }
  const instruction = { reminder: () => Effect.succeed(["<system-reminder>\nINSTRUCTIONS\n</system-reminder>"]) }
  return { messages, parts, sessions, instruction }
}

describe("agents reminder thresholds", () => {
  test("contextTokens prefers total and sums the components otherwise", () => {
    expect(contextTokens(undefined)).toBe(0)
    expect(contextTokens({ ...tokens(10), output: 5 })).toBe(15)
    expect(contextTokens({ ...tokens(10), output: 5, total: 99 })).toBe(99)
  })

  test("builds adaptive thresholds and stops before the compaction margin", () => {
    expect(agentsReminderThresholds(1_000_000)).toEqual([150_000, 300_000, 450_000, 600_000, 750_000])
    expect(agentsReminderThresholds(242_000)).toEqual([40_000, 80_000, 120_000, 160_000])
    expect(agentsReminderThresholds(180_000)).toEqual([40_000, 80_000, 120_000])
    expect(agentsReminderThresholds(108_000)).toEqual([40_000, 80_000])
    expect(agentsReminderThresholds(0)).toEqual([])
  })

  test("dueThresholds only returns crossed, uncovered thresholds", () => {
    const thresholds = agentsReminderThresholds(1_000_000)
    expect(dueThresholds(0, [], 1_000_000)).toEqual([])
    expect(dueThresholds(thresholds[0]!, [], 1_000_000)).toEqual([thresholds[0]!])
    expect(dueThresholds(310_000, [thresholds[0]!], 1_000_000)).toEqual([thresholds[1]!])
    expect(dueThresholds(310_000, thresholds, 1_000_000)).toEqual([])
    expect(dueThresholds(200_000, [], 242_000).at(-1)).toBe(160_000)
  })
})

describe("AgentsReminder.plan and persist", () => {
  test("does nothing below the first threshold", async () => {
    const { instruction } = harness()
    const messages = [userMessage(), assistantMessage(10_000)]
    const plan = await Effect.runPromise(
      AgentsReminder.plan({ messages, config: {}, usableTokens: 1_000_000, instruction }),
    )
    expect(plan).toBeUndefined()
  })

  test("persists a new synthetic message without changing the real user message", async () => {
    const { messages: persisted, parts, sessions, instruction } = harness()
    const messages = [userMessage(), assistantMessage(160_000)]

    const plan = await Effect.runPromise(
      AgentsReminder.plan({ messages, config: {}, usableTokens: 1_000_000, instruction }),
    )
    expect(plan?.thresholds).toEqual([150_000])

    await Effect.runPromise(
      AgentsReminder.persist({ sessionID: "ses_test" as never, messages, plan: plan!, sessions }),
    )

    expect(persisted).toHaveLength(1)
    expect(parts).toHaveLength(1)
    expect(messages).toHaveLength(3)
    expect(messages[0]?.parts).toHaveLength(1)
    expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "real user input" })

    const created = messages[2]!
    expect(created.info.role).toBe("user")
    expect(isSyntheticUserMessage(created)).toBe(true)
    expect(created.parts[0]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        [AGENTS_REMINDER_METADATA_KEY]: {
          kind: "agents-reminder",
          thresholds: [150_000],
        },
      },
    })

    const again = await Effect.runPromise(
      AgentsReminder.plan({ messages, config: {}, usableTokens: 1_000_000, instruction }),
    )
    expect(again).toBeUndefined()
  })

  test("latest ignores synthetic reminder user messages", async () => {
    const { sessions, instruction } = harness()
    const messages = [userMessage(), assistantMessage(160_000)]
    const plan = await Effect.runPromise(
      AgentsReminder.plan({ messages, config: {}, usableTokens: 1_000_000, instruction }),
    )
    await Effect.runPromise(
      AgentsReminder.persist({ sessionID: "ses_test" as never, messages, plan: plan!, sessions }),
    )

    expect(String(MessageV2.latest(messages).user?.id)).toBe("msg_user")
  })
  test("does nothing when the reminder is disabled or empty", async () => {
    const { instruction } = harness()
    const messages = [userMessage(), assistantMessage(160_000)]
    const disabled = await Effect.runPromise(
      AgentsReminder.plan({
        messages,
        config: { experimental: { agents_tail_reminder: false } },
        usableTokens: 1_000_000,
        instruction,
      }),
    )
    expect(disabled).toBeUndefined()

    const empty = await Effect.runPromise(
      AgentsReminder.plan({
        messages,
        config: {},
        usableTokens: 1_000_000,
        instruction: { reminder: () => Effect.succeed([]) },
      }),
    )
    expect(empty).toBeUndefined()
  })
})
