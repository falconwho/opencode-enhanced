import { Memory } from "@/memory"
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
