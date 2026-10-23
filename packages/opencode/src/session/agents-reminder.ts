import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { MessageID, PartID, SessionID } from "./schema"
import {
  AGENTS_REMINDER_METADATA_KEY,
  isAgentsReminderPart,
  isSyntheticUserMessage,
} from "./synthetic-message"

// opencode-enhanced: AGENTS.md reminders are persistent synthetic user
// messages appended at safe turn boundaries. The historical message sequence is
// never modified, so provider prefix caches stay valid.

export const AGENTS_REMINDER_INTERVAL_MIN = 40_000
export const AGENTS_REMINDER_INTERVAL_MAX = 150_000
export const AGENTS_REMINDER_INTERVAL_RATIO = 0.15
export const AGENTS_REMINDER_CEILING_RATIO = 0.8

type MemoryConfig = { experimental?: { agents_tail_reminder?: boolean } }
type InstructionLike = { reminder: () => Effect.Effect<string[], unknown> }
type SessionsLike = {
  updateMessage: (message: SessionV1.User) => Effect.Effect<unknown, unknown>
  updatePart: (part: SessionV1.Part) => Effect.Effect<unknown, unknown>
}

export type ReminderPlan = {
  text: string
  thresholds: number[]
}

function roundUpTenThousand(value: number) {
  return Math.ceil(value / 10_000) * 10_000
}

export function agentsReminderThresholds(usableTokens: number) {
  if (!Number.isFinite(usableTokens) || usableTokens <= 0) return []
  const ceiling = Math.floor(usableTokens * AGENTS_REMINDER_CEILING_RATIO)
  const interval = Math.min(
    AGENTS_REMINDER_INTERVAL_MAX,
    Math.max(AGENTS_REMINDER_INTERVAL_MIN, roundUpTenThousand(usableTokens * AGENTS_REMINDER_INTERVAL_RATIO)),
  )
  const thresholds: number[] = []
  for (let threshold = interval; threshold < ceiling; threshold += interval) thresholds.push(threshold)
  return thresholds
}

export function contextTokens(tokens: SessionV1.Assistant["tokens"] | undefined) {
  if (!tokens) return 0
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function dueThresholds(tokens: number, covered: Iterable<number>, usableTokens: number) {
  const seen = new Set(covered)
  return agentsReminderThresholds(usableTokens).filter(
    (threshold) => tokens >= threshold && !seen.has(threshold),
  )
}

function coveredThresholds(messages: SessionV1.WithParts[]) {
  const covered = new Set<number>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isAgentsReminderPart(part)) continue
      const marker = (part.metadata as Record<string, unknown> | undefined)?.[AGENTS_REMINDER_METADATA_KEY] as
        | { thresholds?: unknown }
        | undefined
      if (!Array.isArray(marker?.thresholds)) continue
      for (const value of marker.thresholds) {
        if (typeof value === "number") covered.add(value)
      }
    }
  }
  return covered
}

export const plan = Effect.fn("AgentsReminder.plan")(function* (input: {
  messages: SessionV1.WithParts[]
  config: MemoryConfig | undefined
  usableTokens: number
  instruction: InstructionLike
}) {
  if (input.config?.experimental?.agents_tail_reminder === false) return

  const lastAssistant = input.messages.findLast(
    (message) => message.info.role === "assistant" && message.info.tokens !== undefined,
  )
  if (!lastAssistant) return
  const tokens = contextTokens(
    lastAssistant.info.role === "assistant" ? lastAssistant.info.tokens : undefined,
  )
  const due = dueThresholds(tokens, coveredThresholds(input.messages), input.usableTokens)
  if (due.length === 0) return

  const reminder = yield* input.instruction.reminder().pipe(Effect.orDie)
  const text = reminder.join("\n\n").trim()
  if (!text) return

  return { text, thresholds: due } satisfies ReminderPlan
})

export const persist = Effect.fn("AgentsReminder.persist")(function* (input: {
  sessionID: SessionID
  messages: SessionV1.WithParts[]
  plan: ReminderPlan
  sessions: SessionsLike
}) {
  const target = input.messages.findLast(
    (message) => message.info.role === "user" && !isSyntheticUserMessage(message),
  )
  if (!target || target.info.role !== "user") return

  const info: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    role: "user",
    synthetic: true,
    time: { created: Date.now() },
    agent: target.info.agent,
    model: { ...target.info.model },
  }
  const part: SessionV1.TextPart = {
    id: PartID.ascending(),
    messageID: info.id,
    sessionID: input.sessionID,
    type: "text",
    text: input.plan.text,
    synthetic: true,
    metadata: {
      [AGENTS_REMINDER_METADATA_KEY]: {
        kind: "agents-reminder",
        thresholds: input.plan.thresholds,
      },
    },
  }

  yield* input.sessions.updateMessage(info)
  yield* input.sessions.updatePart(part)
  input.messages.push({ info, parts: [part] })
  yield* Effect.logInfo("agents reminder injected", {
    sessionID: input.sessionID,
    thresholds: input.plan.thresholds,
  })
  return info
})

export { AGENTS_REMINDER_METADATA_KEY } from "./synthetic-message"
export * as AgentsReminder from "./agents-reminder"
