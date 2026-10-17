import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Context, Effect, Layer, Stream } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"

// opencode-enhanced F8: long-term memory. Extracts durable user facts into
// <data>/memory/MEMORY.md when a session goes idle (config experimental.memory
// must be enabled); the file is injected into the system prompt by
// session/instruction.ts.

export interface Interface {
  readonly file: () => string
  readonly read: () => Effect.Effect<string>
  readonly clear: () => Effect.Effect<void>
  readonly configure: (input: { model?: string; effort?: "low" | "medium" | "high" }) => Effect.Effect<void>
  readonly extract: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

// opencode-enhanced F1/F8: default model for both AI approval judging and
// memory extraction (opencode go plan bundle).
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"

function memoryFile() {
  return path.join(Global.Path.data, "memory", "MEMORY.md")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const cfg = yield* Config.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service

    const extracting = new Set<string>()
    const lastExtracted = new Map<string, string>()
    // opencode-enhanced F1/F8: the app pushes the AI approval model and
    // reasoning effort here so memory extraction follows the same settings.
    const judgment: { model?: string; effort?: "low" | "medium" | "high" } = {}
    const scope = yield* Effect.scope

    const read = Effect.fn("Memory.read")(function* () {
      return yield* Effect.tryPromise(() => fs.readFile(memoryFile(), "utf8").catch(() => "")).pipe(Effect.orDie)
    })

    const clear = Effect.fn("Memory.clear")(function* () {
      yield* Effect.tryPromise(() => fs.rm(memoryFile(), { force: true })).pipe(Effect.ignore)
      lastExtracted.clear()
    })

    const configure = Effect.fn("Memory.configure")(function* (input: {
      model?: string
      effort?: "low" | "medium" | "high"
    }) {
      judgment.model = input.model?.trim() ? input.model.trim() : undefined
      judgment.effort = input.effort
    })

    const extract = Effect.fn("Memory.extract")(function* (sessionID: SessionID) {
      const config = yield* cfg.get()
      if (!config.experimental?.memory) return
      const info = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.parentID) return

      const messages = yield* sessions.messages({ sessionID, limit: 40 }).pipe(
        Effect.catch(() => Effect.succeed([] as SessionV1.WithParts[])),
      )
      const real = messages.filter(
        (message) => message.info.role === "user" && !message.parts.every((p) => "synthetic" in p && p.synthetic),
      )
      const lastUser = real.at(-1)
      if (!lastUser) return
      if (lastExtracted.get(sessionID) === lastUser.info.id) return

      const transcript = messages
        .slice(-20)
        .map((message) => {
          const role = message.info.role
          if (role !== "user" && role !== "assistant") return undefined
          const text = message.parts
            .filter((part) => part.type === "text" && !("synthetic" in part && part.synthetic))
            .map((part) => ("text" in part ? ((part.text as string) ?? "") : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 400)
          return text ? `${role}: ${text}` : undefined
        })
        .filter((line): line is string => !!line)
        .join("\n")
      if (!transcript.trim()) return

      const agent = yield* agents.get("memory").pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!agent) return
      // opencode-enhanced F1/F8: follow the AI approval model/effort when the
      // app has synced them; fall back to the agent config, then the default.
      const refs = [
        judgment.model ? Provider.parseModel(judgment.model) : undefined,
        agent.model,
        Provider.parseModel(DEFAULT_MODEL),
      ].filter((x): x is { providerID: ProviderV2.ID; modelID: ModelV2.ID } => !!x)
      const model = yield* Effect.firstSuccessOf(
        refs.map((ref) => provider.getModel(ref.providerID, ref.modelID)),
      ).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!model) return
      const runAgent = judgment.effort ? { ...agent, options: { ...agent.options, reasoningEffort: judgment.effort } } : agent

      const existing = yield* read()
      const user: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID: sessionID as SessionV1.User["sessionID"],
        role: "user",
        time: { created: Date.now() },
        agent: agent.name,
        model: { providerID: model.providerID, modelID: model.id },
      }
      const output = yield* llm
        .stream({
          agent: runAgent,
          user,
          system: [],
          small: true,
          tools: {},
          model,
          sessionID,
          retries: 1,
          messages: [
            {
              role: "user",
              content: `<current-memory>\n${existing || "(empty)"}\n</current-memory>\n\n<transcript>\n${transcript}\n</transcript>\n\nReturn the complete new memory file, or exactly NO_CHANGE.`,
            },
          ],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.catchCause(() => Effect.succeed("")),
        )
      const cleaned = output.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
      if (!cleaned || cleaned === "NO_CHANGE" || cleaned.length > 6000) {
        if (cleaned === "NO_CHANGE") lastExtracted.set(sessionID, lastUser.info.id)
        return
      }

      yield* Effect.tryPromise(() => fs.mkdir(path.dirname(memoryFile()), { recursive: true })).pipe(Effect.ignore)
      yield* Effect.tryPromise(() => fs.writeFile(memoryFile(), cleaned + "\n", "utf8")).pipe(Effect.ignore)
      lastExtracted.set(sessionID, lastUser.info.id)
      yield* Effect.logInfo("memory updated", { sessionID, bytes: cleaned.length })
    })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== "session.idle") return
        const sessionID = (event.data as { sessionID?: string } | undefined)?.sessionID
        if (!sessionID || extracting.has(sessionID)) return
        extracting.add(sessionID)
        yield* extract(sessionID as SessionID)
          .pipe(
            Effect.catchCause((cause) => Effect.logError("memory extraction failed", { cause: Cause.pretty(cause) })),
            Effect.ensuring(Effect.sync(() => extracting.delete(sessionID))),
            Effect.forkIn(scope),
          )
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({ file: memoryFile, read, clear, configure, extract: (id) => extract(id).pipe(Effect.orDie) })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Config.node, Agent.node, LLM.node, Provider.node, Session.node],
})

export * as Memory from "."
