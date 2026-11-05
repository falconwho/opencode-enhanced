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
  head?: boolean
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

function lastHead(messages: SessionV1.WithParts[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]!
      const value = marker(part)
      if (value?.kind !== "memory-packet" || value.head !== true) continue
      return { message, part: part as SessionV1.TextPart, value }
    }
  }
}

function lastCompaction(messages: SessionV1.WithParts[]) {
  const compacted = new Set<string>()
  for (const message of messages) {
    if (message.info.role !== "user") continue
    if (!message.parts.some((part) => part.type === "compaction")) continue
    compacted.add(message.info.id)
  }
  let latest: { index: number; at: number } | undefined
  for (let i = 0; i < messages.length; i += 1) {
    const info = messages[i]!.info
    if (info.role !== "assistant") continue
    if (!info.summary || !info.finish || info.error) continue
    if (!compacted.has(info.parentID)) continue
    if (latest && info.time.created <= latest.at) continue
    latest = { index: i, at: info.time.created }
  }
  return latest ?? { index: -1, at: 0 }
}

function isMemoryMessage(message: SessionV1.WithParts) {
  return message.parts.some((part) => {
    const value = marker(part)
    return value?.kind === "memory-packet" || value?.kind === "memory-delta"
  })
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
  const boundary = lastCompaction(input.messages)
  const head = lastHead(input.messages)

  if (boundary.index !== -1 || head) {
    const messages = input.messages.filter((message) => !isMemoryMessage(message))
    if (!context) return messages
    if (head && head.value.at !== undefined && head.value.at > boundary.at) {
      const packet = yield* updateHead({
        head,
        sessions: input.sessions,
        context,
        now,
      })
      messages.unshift(packet)
      return messages
    }
    const packet = yield* create({
      session: input.session,
      sessions: input.sessions,
      agent: input.agent.name,
      model,
      text: context.text,
      hash: context.hash,
      kind: "memory-packet",
      at: now,
      head: true,
    })
    messages.unshift(packet)
    return messages
  }

  if (!context) return input.messages
  if (!previous) {
    const packet = yield* create({
      session: input.session,
      sessions: input.sessions,
      agent: input.agent.name,
      model,
      text: context.text,
      hash: context.hash,
      kind: "memory-packet",
      at: now,
    })
    input.messages.push(packet)
    return input.messages
  }
  const delta = yield* input.memory.delta(input.session.id, previous.value.at ?? 0)
  const deltaHash = delta ? digest(delta) : undefined
  if (
    delta &&
    deltaHash &&
    (previous.value.kind !== "memory-delta" || previous.value.hash !== deltaHash)
  ) {
    const packet = yield* create({
      session: input.session,
      sessions: input.sessions,
      agent: input.agent.name,
      model,
      text: delta,
      hash: deltaHash,
      kind: "memory-delta",
      at: now,
    })
    input.messages.push(packet)
  }
  return input.messages
})

function updateHead(input: {
  head: {
    message: SessionV1.WithParts
    part: SessionV1.TextPart
    value: MemoryMarker
  }
  sessions: Session.Interface
  context: { text: string; hash: string }
  now: number
}) {
  return Effect.gen(function* () {
    if (input.head.value.hash === input.context.hash) return input.head.message
    const part: SessionV1.TextPart = {
      ...input.head.part,
      text: input.context.text,
      metadata: {
        ...input.head.part.metadata,
        [MARKER]: {
          kind: "memory-packet",
          hash: input.context.hash,
          at: input.now,
          head: true,
        },
      },
    }
    yield* input.sessions.updatePart(part)
    input.head.message.parts = input.head.message.parts.map((item) => (item.id === part.id ? part : item))
    return input.head.message
  })
}

function create(input: {
  session: Session.Info
  sessions: Session.Interface
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  text: string
  hash: string
  kind: "memory-packet" | "memory-delta"
  at: number
  head?: boolean
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
          ...(input.head ? { head: true } : {}),
        },
      },
    }
    yield* input.sessions.updatePart(part)
    return { info: message, parts: [part] }
  })
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export * as MemoryContext from "./memory-context"
