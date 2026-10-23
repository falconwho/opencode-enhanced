import type { Message, Part } from "@opencode-ai/sdk/v2"

const AGENTS_REMINDER_METADATA_KEY = "opencode-enhanced"

export function isAgentsReminderPart(part: Part) {
  if (part.type !== "text" || !part.synthetic) return false
  const marker = (part.metadata as Record<string, unknown> | undefined)?.[AGENTS_REMINDER_METADATA_KEY] as
    | { kind?: string }
    | undefined
  return marker?.kind === "agents-reminder"
}

// System-generated AGENTS reminder messages carry model context only and must
// never render as a user conversation turn.
export function isSyntheticAgentsReminderMessage(message: Message, parts: Part[] | undefined) {
  if (message.role !== "user") return false
  if ((message as Message & { synthetic?: boolean }).synthetic === true) return true
  if (!parts?.length) return false
  return parts.every(isAgentsReminderPart)
}
