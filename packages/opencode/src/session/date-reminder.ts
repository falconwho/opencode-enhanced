import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { PartID } from "./schema"
import { Session } from "./session"
import { isSyntheticUserMessage } from "./synthetic-message"

export const CURRENT_DATE_METADATA_KEY = "opencode-enhanced"
export const CURRENT_DATE_KIND = "current-date"

function dateOf(part: SessionV1.Part) {
  if (part.type !== "text" || !part.synthetic) return
  const marker = (part.metadata as Record<string, unknown> | undefined)?.[CURRENT_DATE_METADATA_KEY] as
    | { kind?: unknown; date?: unknown }
    | undefined
  if (marker?.kind !== CURRENT_DATE_KIND || typeof marker.date !== "string") return
  return marker.date
}

function latestDate(messages: SessionV1.WithParts[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const parts = messages[messageIndex]?.parts ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const date = dateOf(parts[partIndex]!)
      if (date) return date
    }
  }
}

export const apply = Effect.fn("SessionDate.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  sessions: Session.Interface
  now?: () => Date
}) {
  const userMessage = input.messages.at(-1)
  if (userMessage?.info.role !== "user" || isSyntheticUserMessage(userMessage)) return input.messages
  if (userMessage.parts.some((part) => dateOf(part))) return input.messages

  const date = (input.now?.() ?? new Date()).toDateString()
  if (latestDate(input.messages) === date) return input.messages

  const part = yield* input.sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: `<system-reminder>\nCurrent date: ${date}\n</system-reminder>`,
    synthetic: true,
    metadata: {
      [CURRENT_DATE_METADATA_KEY]: {
        kind: CURRENT_DATE_KIND,
        date,
      },
    },
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionDate from "./date-reminder"
