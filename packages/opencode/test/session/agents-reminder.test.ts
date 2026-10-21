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

const tokens = (used: number) => ({
  input: used,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

function userMessage() {
  return {
    info: {
      id: "msg_user",
      sessionID: "ses_test",
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [],
  } as unknown as SessionV1.WithParts
}

function assistantMessage(used: number) {
  return {
    info: {
      id: "msg_assistant",
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 0 },
      tokens: tokens(used),
    },
    parts: [],
  } as unknown as SessionV1.WithParts
}

function harness() {
  const updates: SessionV1.Part[] = []
  const sessions = {
    updatePart: (part: SessionV1.Part) =>
      Effect.sync(() => {
        updates.push(part)
      }),
  }
  const instruction = { reminder: () => Effect.succeed(["<system-reminder>\nINSTRUCTIONS\n</system-reminder>"]) }
  return { updates, sessions, instruction }
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

describe("AgentsReminder.apply", () => {
  test("does nothing below the first threshold", async () => {
    const { updates, sessions, instruction } = harness()
    const messages = [userMessage(), assistantMessage(10_000)]
    await Effect.runPromise(
      AgentsReminder.apply({
        sessionID: "ses_test" as never,
        messages,
        config: {},
        usableTokens: 1_000_000,
        instruction,
        sessions,
      }),
    )
    expect(updates).toEqual([])
  })

  test("persists a synthetic reminder and never repeats a threshold", async () => {
    const { updates, sessions, instruction } = harness()
    const messages = [userMessage(), assistantMessage(160_000)]
    const run = () =>
      Effect.runPromise(
        AgentsReminder.apply({
          sessionID: "ses_test" as never,
          messages,
          config: {},
          usableTokens: 1_000_000,
          instruction,
          sessions,
        }),
      )

    await run()
    expect(updates).toHaveLength(1)
    const part = updates[0] as SessionV1.TextPart
    expect(part.type).toBe("text")
    expect(part.synthetic).toBe(true)
    expect(part.text).toContain("INSTRUCTIONS")
    const marker = (part.metadata as Record<string, unknown>)[AGENTS_REMINDER_METADATA_KEY] as {
      kind: string
      thresholds: number[]
    }
    expect(marker.kind).toBe("agents-reminder")
    expect(marker.thresholds).toEqual([150_000])

    await run()
    expect(updates).toHaveLength(1)

    messages.push(assistantMessage(310_000))
    await run()
    expect(updates).toHaveLength(2)
    const next = (updates[1] as SessionV1.TextPart).metadata as Record<string, unknown>
    expect((next[AGENTS_REMINDER_METADATA_KEY] as { thresholds: number[] }).thresholds).toEqual([300_000])
  })

  test("does nothing when the reminder is disabled or empty", async () => {
    const messages = [userMessage(), assistantMessage(160_000)]
    const { updates, sessions, instruction } = harness()
    await Effect.runPromise(
      AgentsReminder.apply({
        sessionID: "ses_test" as never,
        messages,
        config: { experimental: { agents_tail_reminder: false } },
        usableTokens: 1_000_000,
        instruction,
        sessions,
      }),
    )
    expect(updates).toEqual([])

    await Effect.runPromise(
      AgentsReminder.apply({
        sessionID: "ses_test" as never,
        messages,
        config: {},
        usableTokens: 1_000_000,
        instruction: { reminder: () => Effect.succeed([]) },
        sessions,
      }),
    )
    expect(updates).toEqual([])
  })
})
