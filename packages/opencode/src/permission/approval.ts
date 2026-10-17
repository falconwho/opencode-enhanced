import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Context, Duration, Effect, Layer, Option, Schema, Stream } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID } from "@/session/schema"

// opencode-enhanced: approval.jsonl rotation. Once the log exceeds
// MAX_LOG_BYTES it is renamed to approval-<ts>.jsonl and a fresh file is
// started; only the newest MAX_ARCHIVES archives are kept, so long-term disk
// usage is bounded.
const MAX_LOG_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVES = 5

async function rotateApprovalLog(logPath: string) {
  try {
    const stat = await fs.stat(logPath)
    if (stat.size < MAX_LOG_BYTES) return
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    await fs.rename(logPath, path.join(path.dirname(logPath), `approval-${ts}.jsonl`))
    const dir = path.dirname(logPath)
    const archives = (await fs.readdir(dir))
      .filter((name) => /^approval-\d{4}-\d{2}-\d{2}T.*\.jsonl$/.test(name))
      .sort()
    for (const oldest of archives.slice(0, Math.max(0, archives.length - MAX_ARCHIVES))) {
      await fs.unlink(path.join(dir, oldest)).catch(() => undefined)
    }
  } catch {
    // ignore: file does not exist yet or rotation failed; append below still proceeds
  }
}

export interface JudgeInput {
  readonly sessionID: string
  readonly permission: string
  readonly patterns: readonly string[]
  readonly metadata?: Record<string, unknown>
  readonly tool?: { messageID: string; callID: string } | string
  readonly model?: string
  readonly effort?: "low" | "medium" | "high"
}

export interface JudgeResult {
  readonly decision: "allow" | "deny"
  readonly reason: string
}

export class JudgeUnavailableError extends Schema.TaggedErrorClass<JudgeUnavailableError>()(
  "ApprovalJudgeUnavailable",
  { message: Schema.String },
) {}

export interface Interface {
  readonly judge: (input: JudgeInput) => Effect.Effect<JudgeResult, JudgeUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Approval") {}

// opencode-enhanced F1: default approval judge model (opencode go plan bundle), low reasoning effort.
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"
const TIMEOUT = Duration.seconds(15)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service

    const unavailable = (message: string) => new JudgeUnavailableError({ message })

    const judge = Effect.fn("Approval.judge")(function* (input: JudgeInput) {
      const started = Date.now()
      const base = yield* agents.get("approval").pipe(Effect.mapError(() => unavailable("approval agent unavailable")))

      const refs = [
        input.model ? Provider.parseModel(input.model) : undefined,
        base.model,
        Provider.parseModel(DEFAULT_MODEL),
      ].filter((x): x is { providerID: ProviderV2.ID; modelID: ModelV2.ID } => !!x)
      const model = yield* Effect.firstSuccessOf(
        refs.map((ref) => provider.getModel(ref.providerID, ref.modelID)),
      ).pipe(Effect.mapError(() => unavailable("no approval model available")))

      const agent = input.effort ? { ...base, options: { ...base.options, reasoningEffort: input.effort } } : base
      const user: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID: input.sessionID as SessionV1.User["sessionID"],
        role: "user",
        time: { created: started },
        agent: agent.name,
        model: { providerID: model.providerID, modelID: model.id },
      }
      const payload = JSON.stringify(
        {
          permission: input.permission,
          patterns: input.patterns,
          metadata: input.metadata,
          tool: input.tool,
        },
        null,
        2,
      ).slice(0, 4000)

      const text = yield* llm
        .stream({
          agent,
          user,
          system: [],
          small: true,
          tools: {},
          model,
          sessionID: input.sessionID,
          retries: 1,
          messages: [
            {
              role: "user",
              content: `Judge this permission request. Reply with JSON only.\n<permission-request>\n${payload}\n</permission-request>`,
            },
          ],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.catchCause((cause) => Effect.fail(unavailable(Cause.pretty(cause).slice(0, 300)))),
          Effect.timeoutOption(TIMEOUT),
        )
      if (Option.isNone(text)) return yield* unavailable("approval judge timed out")

      const match = /\{[^{}]*\}/.exec(text.value.replace(/<think>[\s\S]*?<\/think>/g, ""))
      const parsed = yield* Effect.try({
        try: () => (match ? JSON.parse(match[0]) : undefined) as { decision?: unknown; reason?: unknown } | undefined,
        catch: () => unavailable("approval judge returned invalid JSON"),
      })
      if (parsed?.decision !== "allow" && parsed?.decision !== "deny") {
        return yield* unavailable("approval judge returned no decision")
      }
      const result: JudgeResult = {
        decision: parsed.decision,
        reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
      }

      const logPath = path.join(Global.Path.log, "approval.jsonl")
      yield* Effect.tryPromise(() => rotateApprovalLog(logPath)).pipe(Effect.ignore)
      yield* Effect.tryPromise(() =>
        fs.appendFile(
          logPath,
          JSON.stringify({
            ts: new Date().toISOString(),
            sessionID: input.sessionID,
            permission: input.permission,
            patterns: input.patterns.map((x) => x.slice(0, 200)),
            metadata: input.metadata,
            tool: input.tool,
            decision: result.decision,
            reason: result.reason,
            model: `${model.providerID}/${model.id}`,
            ms: Date.now() - started,
          }) + "\n",
        ),
      ).pipe(Effect.ignore)

      return result
    })

    return Service.of({ judge })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Agent.node, LLM.node, Provider.node] })

export * as Approval from "./approval"
