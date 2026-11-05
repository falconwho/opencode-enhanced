import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { MEMORY_KINDS, MEMORY_SCOPES } from "./types"
import { Service } from "./service"

const Scope = Schema.optional(Schema.Literals([...MEMORY_SCOPES, "all"]))
const Kind = Schema.Literals(MEMORY_KINDS)
const Entity = Schema.Struct({
  name: Schema.String,
  kind: Schema.optional(Schema.String),
  aliases: Schema.optional(Schema.Array(Schema.String)),
})

const SaveParameters = Schema.Struct({
  content: Schema.optional(Schema.String),
  kind: Schema.optional(Kind),
  scope: Schema.optional(Schema.Literals(MEMORY_SCOPES)),
  importance: Schema.optional(Schema.Number),
  placard: Schema.optional(Schema.String),
  entities: Schema.optional(Schema.Array(Entity)),
  items: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.String,
        kind: Kind,
        importance: Schema.optional(Schema.Number),
      }),
    ),
  ),
})

const SearchParameters = Schema.Struct({
  query: Schema.String,
  scope: Scope,
  room: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  asOf: Schema.optional(Schema.Number),
})

const ReadParameters = Schema.Struct({ ids: Schema.Array(Schema.String) })

const FactsParameters = Schema.Struct({
  entity: Schema.optional(Schema.String),
  entityId: Schema.optional(Schema.String),
  facts: Schema.optional(Schema.Array(Schema.Struct({ content: Schema.String, replaces: Schema.optional(Schema.String) }))),
  asOf: Schema.optional(Schema.Number),
  includeInvalid: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
})

const AssessParameters = Schema.Struct({
  batchId: Schema.String,
  evidenceRefs: Schema.Array(Schema.String),
  missing: Schema.optional(Schema.String),
  nextStrategy: Schema.String,
  sufficient: Schema.Boolean,
})

const TimelineParameters = Schema.Struct({
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  order: Schema.optional(Schema.Literals(["recent", "tour"])),
  room: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

const MutateParameters = Schema.Struct({
  id: Schema.String,
  action: Schema.Literals(["update", "forget", "archive", "restore"]),
  content: Schema.optional(Schema.String),
  kind: Schema.optional(Kind),
  importance: Schema.optional(Schema.Number),
})

const DistillParameters = Schema.Struct({
  scope: Schema.optional(Schema.Literals(["user", "project", "shared", "all"])),
})

const NavigateParameters = Schema.Struct({
  mode: Schema.Literals(["neighbors", "tour"]),
  id: Schema.optional(Schema.String),
  hops: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})

function output(value: unknown, title: string): Tool.ExecuteResult {
  return { title, metadata: {}, output: JSON.stringify(value, null, 2) }
}

export const MemorySaveTool = Tool.define(
  "memory_save",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description:
        "Save durable long-term memory. Use only for facts, preferences, decisions, episodes or skills worth recalling across sessions.",
      parameters: SaveParameters,
      execute: (params: Schema.Schema.Type<typeof SaveParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_save", patterns: ["*"], always: ["*"], metadata: {} })
          const items = params.items ?? (params.content && params.kind ? [{ content: params.content, kind: params.kind }] : [])
          if (!items.length) throw new Error("content and kind are required")
          const results = []
          for (const item of items) {
            results.push(
              yield* memory.save(ctx.sessionID, {
                content: item.content,
                kind: item.kind,
                scope: params.scope ?? "project",
                importance: item.importance ?? params.importance,
                placard: params.placard,
                entities: params.entities,
                sourceSessionID: ctx.sessionID,
              } as never),
            )
          }
          return output(results, `saved ${results.length} memory item(s)`)
        }),
    }
  }),
)

export const MemorySearchTool = Tool.define(
  "memory_search",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description:
        "Search long-term memory using keyword and vector retrieval. Use room to search a palace room. Results include id, ref and batch id for memory_assess.",
      parameters: SearchParameters,
      execute: (params: Schema.Schema.Type<typeof SearchParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_search", patterns: [params.query], always: ["*"], metadata: {} })
          const result = yield* memory.search(ctx.sessionID, {
            query: params.query,
            scope: params.scope,
            room: params.room,
            limit: params.limit,
            asOf: params.asOf,
          })
          const lines = result.hits.map((hit, index) => {
            const slot = hit.node.slot ? ` ${hit.node.slot.room}#${hit.node.slot.index}` : ""
            return `${index + 1}. [${hit.node.scope}/${hit.node.kind}]${slot} ${hit.node.content.slice(0, 600)} id=${hit.node.id} ref=${hit.ref}`
          })
          if (result.batchID) lines.push(`batch=${result.batchID}`)
          if (result.degraded) lines.push("degraded=keyword-only")
          return output(lines.length ? lines : ["(no memory found)"], params.query)
        }),
    }
  }),
)

export const MemoryReadTool = Tool.define(
  "memory_read",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Read complete memory records by id.",
      parameters: ReadParameters,
      execute: (params: Schema.Schema.Type<typeof ReadParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_read", patterns: params.ids, always: ["*"], metadata: {} })
          return output(yield* memory.read(ctx.sessionID, params.ids.slice(0, 16)), `${params.ids.length} id(s)`)
        }),
    }
  }),
)

export const MemoryFactsTool = Tool.define(
  "memory_facts",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Read or write entity facts with valid/invalid time windows.",
      parameters: FactsParameters,
      execute: (params: Schema.Schema.Type<typeof FactsParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_facts", patterns: [params.entity ?? params.entityId ?? "*"], always: ["*"], metadata: {} })
          return output(yield* memory.facts(ctx.sessionID, params as Record<string, unknown>), "memory facts")
        }),
    }
  }),
)

export const MemoryAssessTool = Tool.define(
  "memory_assess",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Evidence gate. Declare whether retrieved evidence is sufficient before answering.",
      parameters: AssessParameters,
      execute: (params: Schema.Schema.Type<typeof AssessParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_assess", patterns: [params.batchId], always: ["*"], metadata: {} })
          return output(
            yield* memory.assess(ctx.sessionID, {
              batchID: params.batchId,
              refs: [...params.evidenceRefs],
              sufficient: params.sufficient,
              nextStrategy: params.nextStrategy,
            }),
            "memory assessment",
          )
        }),
    }
  }),
)

export const MemoryTimelineTool = Tool.define(
  "memory_timeline",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Browse memory chronology, optionally following the fixed palace route.",
      parameters: TimelineParameters,
      execute: (params: Schema.Schema.Type<typeof TimelineParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_timeline", patterns: ["*"], always: ["*"], metadata: {} })
          return output(yield* memory.timeline(ctx.sessionID, params), "memory timeline")
        }),
    }
  }),
)

export const MemoryMutateTool = Tool.define(
  "memory_mutate",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Update, forget, archive or restore an existing memory.",
      parameters: MutateParameters,
      execute: (params: Schema.Schema.Type<typeof MutateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_mutate", patterns: [params.id], always: ["*"], metadata: {} })
          return output(yield* memory.mutate(ctx.sessionID, params), `memory ${params.action}`)
        }),
    }
  }),
)

export const MemoryDistillTool = Tool.define(
  "memory_distill",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Consolidate related memories into higher-level fact or skill entries and archive the sources.",
      parameters: DistillParameters,
      execute: (params: Schema.Schema.Type<typeof DistillParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_distill", patterns: [params.scope ?? "all"], always: ["*"], metadata: {} })
          const result =
            params.scope === "all" || params.scope === undefined
              ? yield* memory.distillAll()
              : yield* memory.distill(ctx.sessionID, params.scope)
          return output(result, "memory distill")
        }),
    }
  }),
)

export const MemoryNavigateTool = Tool.define(
  "memory_navigate",
  Effect.gen(function* () {
    const memory = yield* Service
    return {
      description: "Walk one to three relationship hops from a memory, or list the fixed palace tour.",
      parameters: NavigateParameters,
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "memory_navigate", patterns: [params.id ?? "*"], always: ["*"], metadata: {} })
          return output(yield* memory.navigate(ctx.sessionID, params), "memory navigation")
        }),
    }
  }),
)

export const MemoryV3Tools = [
  MemorySaveTool,
  MemorySearchTool,
  MemoryReadTool,
  MemoryFactsTool,
  MemoryAssessTool,
  MemoryTimelineTool,
  MemoryMutateTool,
  MemoryDistillTool,
  MemoryNavigateTool,
]
