import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { PartID, SessionID } from "./schema"

// opencode-enhanced: AGENTS.md reminders are persisted once at explicit context
// thresholds. Persisting the block keeps its position fixed, so it does not move
// (and invalidate the prompt cache) on every turn.

export const AGENTS_REMINDER_THRESHOLDS = [130_000, 300_000, 450_000, 600_000, 750_000] as const
export const AGENTS_REMINDER_METADATA_KEY = "opencode-enhanced"

type MemoryConfig = { experimental?: { agents_tail_reminder?: boolean } }
type InstructionLike = { reminder: () => Effect.Effect<string[], unknown> }
type SessionsLike = { updatePart: (part: SessionV1.Part) => Effect.Effect<unknown, unknown> }

export function contextTokens(tokens: SessionV1.Assistant["tokens"] | undefined) {
  if (!tokens) return 0
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function dueThresholds(tokens: number, covered: Iterable<number>) {
  const seen = new Set(covered)
  return AGENTS_REMINDER_THRESHOLDS.filter((threshold) => tokens >= threshold && !seen.has(threshold))
}

function coveredThresholds(messages: SessionV1.WithParts[]) {
  const covered = new Set<number>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "text" || !part.synthetic) continue
      const marker = (part.metadata as Record<string, unknown> | undefined)?.[AGENTS_REMINDER_METADATA_KEY] as
        | { kind?: string; thresholds?: unknown }
        | undefined
      if (marker?.kind !== "agents-reminder") continue
      if (!Array.isArray(marker.thresholds)) continue
      for (const value of marker.thresholds) {
        if (typeof value === "number") covered.add(value)
      }
    }
  }
  return covered
}

export const apply = Effect.fn("AgentsReminder.apply")(function* (input: {
  sessionID: SessionID
  messages: SessionV1.WithParts[]
  config: MemoryConfig | undefined
  instruction: InstructionLike
  sessions: SessionsLike
}) {
  if (input.config?.experimental?.agents_tail_reminder === false) return

  const lastAssistant = input.messages.findLast(
    (message) => message.info.role === "assistant" && message.info.tokens !== undefined,
  )
  if (!lastAssistant) return
  const tokens = contextTokens(
    lastAssistant.info.role === "assistant" ? lastAssistant.info.tokens : undefined,
  )
  const due = dueThresholds(tokens, coveredThresholds(input.messages))
  if (due.length === 0) return

  const reminder = yield* input.instruction.reminder().pipe(Effect.orDie)
  const text = reminder.join("\n\n").trim()
  if (!text) return

  const target = input.messages.findLast((message) => message.info.role === "user")
  if (!target) return

  const part = {
    id: PartID.ascending(),
    messageID: target.info.id,
    sessionID: input.sessionID,
    type: "text" as const,
    text,
    synthetic: true,
    metadata: {
      [AGENTS_REMINDER_METADATA_KEY]: { kind: "agents-reminder", thresholds: due },
    },
  }
  target.parts.push(part)
  yield* input.sessions.updatePart(part).pipe(Effect.ignore)
  yield* Effect.logInfo("agents reminder injected", { sessionID: input.sessionID, thresholds: due })
})

export * as AgentsReminder from "./agents-reminder"
