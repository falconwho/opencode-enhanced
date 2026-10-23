import { SessionV1 } from "@opencode-ai/core/v1/session"

export const AGENTS_REMINDER_METADATA_KEY = "opencode-enhanced"

export function isAgentsReminderPart(part: SessionV1.Part): part is SessionV1.TextPart {
  if (part.type !== "text" || !part.synthetic) return false
  const marker = (part.metadata as Record<string, unknown> | undefined)?.[AGENTS_REMINDER_METADATA_KEY] as
    | { kind?: string }
    | undefined
  return marker?.kind === "agents-reminder"
}

// A system-generated user message used only for model context. It must be
// ignored anywhere the "last real user message" or a visible user turn matters.
export function isSyntheticUserMessage(message: SessionV1.WithParts) {
  if (message.info.role !== "user" || message.parts.length === 0) return false
  return message.parts.every(isAgentsReminderPart)
}

export * as SyntheticMessage from "./synthetic-message"
