import { Memory } from "@/memory"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/memory"

// opencode-enhanced F1/F8: the app syncs the AI approval model and reasoning
// effort here so memory extraction follows the same settings.
export const MemoryConfigInput = Schema.Struct({
  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.Literals(["low", "medium", "high"])),
})

// opencode-enhanced F8: read/clear the Codex v2 memory summary.
const MemoryV3Query = Schema.Struct({ ...WorkspaceRoutingQueryFields, sessionID: Schema.optional(Schema.String) })
export const MemoryApi = HttpApi.make("memory").add(
  HttpApiGroup.make("memory")
    .add(
      HttpApiEndpoint.get("get", root, {
        query: WorkspaceRoutingQuery,
        success: described(
          Schema.Struct({ path: Schema.String, content: Schema.String }),
          "Memory summary path and content",
        ),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.get",
          summary: "Read memory summary",
          description: "Get the memory_summary.md path and its current content.",
        }),
      ),
      HttpApiEndpoint.get("summary", `${root}/summary`, {
        query: WorkspaceRoutingQuery,
        success: described(
          Schema.Struct({ path: Schema.String, content: Schema.String }),
          "Memory summary path and content",
        ),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.summary",
          summary: "Read memory summary",
          description: "Get the consolidated memory_summary.md path and its current content.",
        }),
      ),
      HttpApiEndpoint.post("clear", `${root}/clear`, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Memory cleared"),
        error: [HttpApiError.BadRequest],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.clear",
          summary: "Clear long-term memory",
          description:
            "Delete memory_summary.md, rollout_summaries, ad-hoc notes and the extraction state, then reset in-memory caches.",
        }),
      ),
      HttpApiEndpoint.post("configure", `${root}/config`, {
        query: WorkspaceRoutingQuery,
        payload: MemoryConfigInput,
        success: described(Schema.Boolean, "Memory extraction configuration applied"),
        error: [HttpApiError.BadRequest],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.configure",
          summary: "Configure memory extraction",
          description:
            "opencode-enhanced: sync the model and reasoning effort used for memory extraction (follows the AI approval settings).",
        }),
      ),
      HttpApiEndpoint.get("v3Stats", `${root}/v3/stats`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 stats"),
      }),
      HttpApiEndpoint.get("v3Nodes", `${root}/v3/nodes`, {
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          sessionID: Schema.optional(Schema.String),
          status: Schema.optional(Schema.String),
          kind: Schema.optional(Schema.String),
          room: Schema.optional(Schema.String),
          query: Schema.optional(Schema.String),
          limit: Schema.optional(Schema.NumberFromString),
          offset: Schema.optional(Schema.NumberFromString),
        }),
        success: described(Schema.Unknown, "Memory v3 nodes"),
      }),
      HttpApiEndpoint.get("v3ProfileGet", `${root}/v3/profile`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 profile"),
      }),
      HttpApiEndpoint.post("v3ProfileSet", `${root}/v3/profile`, {
        query: MemoryV3Query,
        payload: Schema.Struct({ content: Schema.String }),
        success: described(Schema.Unknown, "Memory v3 profile update"),
      }),
      HttpApiEndpoint.get("v3Rooms", `${root}/v3/rooms`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 rooms"),
      }),
      HttpApiEndpoint.get("v3Audit", `${root}/v3/audit`, {
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          sessionID: Schema.optional(Schema.String),
          targetID: Schema.optional(Schema.String),
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: described(Schema.Unknown, "Memory v3 audit"),
      }),
      HttpApiEndpoint.get("v3Suggestions", `${root}/v3/reflect`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 reflection suggestions"),
      }),
      HttpApiEndpoint.post("v3Reflect", `${root}/v3/reflect/run`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 reflection run"),
      }),
      HttpApiEndpoint.post("v3ReflectDecide", `${root}/v3/reflect/decide`, {
        query: MemoryV3Query,
        payload: Schema.Struct({
          id: Schema.String,
          action: Schema.Literals(["accept", "reject"]),
        }),
        success: described(Schema.Unknown, "Memory v3 reflection decision"),
      }),
      HttpApiEndpoint.get("v3Export", `${root}/v3/export`, {
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          sessionID: Schema.optional(Schema.String),
          format: Schema.optional(Schema.Literals(["json", "markdown"])),
        }),
        success: described(Schema.String, "Memory v3 export"),
      }),
      HttpApiEndpoint.post("v3Backup", `${root}/v3/backup`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 local backup"),
      }),
      HttpApiEndpoint.post("v3Import", `${root}/v3/import`, {
        query: MemoryV3Query,
        payload: Schema.Struct({ data: Schema.String }),
        success: described(Schema.Unknown, "Memory v3 import"),
      }),
      HttpApiEndpoint.post("v3RebuildEmbeddings", `${root}/v3/rebuild-embeddings`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 embedding rebuild"),
      }),
      HttpApiEndpoint.get("v3ReviewQueue", `${root}/v3/review`, {
        query: MemoryV3Query,
        success: described(Schema.Unknown, "Memory v3 review queue"),
      }),
      HttpApiEndpoint.post("v3ReviewGrade", `${root}/v3/review`, {
        query: MemoryV3Query,
        payload: Schema.Struct({ id: Schema.String, grade: Schema.Number }),
        success: described(Schema.Unknown, "Memory v3 review grade"),
      }),
      HttpApiEndpoint.post("v3Mutate", `${root}/v3/mutate`, {
        query: MemoryV3Query,
        payload: Schema.Struct({
          id: Schema.String,
          action: Schema.Literals(["update", "forget", "archive", "restore"]),
          content: Schema.optional(Schema.String),
          importance: Schema.optional(Schema.Number),
        }),
        success: described(Schema.Unknown, "Memory v3 mutation"),
      }),
      HttpApiEndpoint.post("v3Clear", `${root}/v3/clear`, {
        query: MemoryV3Query,
        success: described(Schema.Boolean, "Memory v3 cleared"),
      }),
      HttpApiEndpoint.get("v3Search", `${root}/v3/search`, {
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          sessionID: Schema.optional(Schema.String),
          query: Schema.String,
          room: Schema.optional(Schema.String),
          limit: Schema.optional(Schema.NumberFromString),
        }),
        success: described(Schema.Unknown, "Memory v3 search"),
      }),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "memory",
        description: "opencode-enhanced long-term memory routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
