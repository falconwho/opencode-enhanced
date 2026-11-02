import { SessionV1 } from "@opencode-ai/core/v1/session"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import { MemoryV3 } from "@/memory/v3"
import { MessageID, PartID } from "./schema"
import { Session } from "./session"

const MARKER = "opencode-enhanced"

type MemoryMarker = {
  kind?: string
  hash?: string
  at?: number
}

function marker(part: SessionV1.Part) {
  if (part.type !== "text" || !part.synthetic) return
  return (part.metadata as Record<string, unknown> | undefined)?.[MARKER] as MemoryMarker | undefined
}

function lastPacket(messages: SessionV1.WithParts[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const value = marker(parts[j]!)
      if (value?.kind === "memory-packet" || value?.kind === "memory-delta") {
        return { message: messages[i]!, part: parts[j]!, value }
      }
    }
  }
}

export const apply = Effect.fn("MemoryContext.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  session: Session.Info
  agent: { name: string }
  sessions: Session.Interface
  memory: MemoryV3.Interface
  now?: number
}) {
  if (!(yield* input.memory.enabled())) return input.messages
  const realUser = input.messages.findLast((message) => message.info.role === "user" && !message.info.synthetic)
  if (!realUser || realUser.info.role !== "user") return input.messages
  const model = realUser.info.model
  const now = input.now ?? Date.now()
  const previous = lastPacket(input.messages)
  const context = yield* input.memory.context(input.session.id)
  if (!context) return input.messages
  if (!previous) {
    yield* append({
      messages: input.messages,
      session: input.session,
      sessions: input.sessions,
      agent: input.agent.name,
      model,
      text: context.text,
      hash: context.hash,
      kind: "memory-packet",
      at: now,
    })
    return input.messages
  }
  const delta = yield* input.memory.delta(input.session.id, previous.value.at ?? 0)
  const deltaHash = delta ? digest(delta) : undefined
  if (
    delta &&
    deltaHash &&
    (previous.value.kind !== "memory-delta" || previous.value.hash !== deltaHash)
  ) {
    yield* append({
      messages: input.messages,
      session: input.session,
      sessions: input.sessions,
      agent: input.agent.name,
      model,
      text: delta,
      hash: deltaHash,
      kind: "memory-delta",
      at: now,
    })
  }
  return input.messages
})

function append(input: {
  messages: SessionV1.WithParts[]
  session: Session.Info
  sessions: Session.Interface
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  text: string
  hash: string
  kind: "memory-packet" | "memory-delta"
  at: number
}) {
  return Effect.gen(function* () {
    const message: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID: input.session.id,
      role: "user",
      synthetic: true,
      time: { created: input.at },
      agent: input.agent,
      model: {
        providerID: input.model.providerID as never,
        modelID: input.model.modelID as never,
        variant: input.model.variant,
      },
    }
    yield* input.sessions.updateMessage(message)
    const part: SessionV1.TextPart = {
      id: PartID.ascending(),
      messageID: message.id,
      sessionID: input.session.id,
      type: "text",
      text: input.text,
      synthetic: true,
      metadata: {
        [MARKER]: {
          kind: input.kind,
          hash: input.hash,
          at: input.at,
        },
      },
    }
    yield* input.sessions.updatePart(part)
    input.messages.push({ info: message, parts: [part] })
  })
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export * as MemoryContext from "./memory-context"
