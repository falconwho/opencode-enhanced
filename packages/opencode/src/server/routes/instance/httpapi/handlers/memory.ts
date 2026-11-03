import { Memory } from "@/memory"
import { Service as MemoryV3 } from "@/memory/v3/service"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { MemoryConfigInput } from "../groups/memory"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Memory.Service
    const v3 = yield* MemoryV3

    const safe = <T,>(value: T): unknown =>
      value === undefined ? null : JSON.parse(JSON.stringify(value))

    const resolve = (sessionID?: string) =>
      Effect.gen(function* () {
        return sessionID ?? (yield* v3.latestSessionID())
      })

    const get = Effect.fn("MemoryHttpApi.get")(function* () {
      const content = yield* svc.read()
      return { path: svc.file(), content }
    })

    const summary = Effect.fn("MemoryHttpApi.summary")(function* () {
      const content = yield* svc.read()
      return { path: svc.file(), content }
    })

    const clear = Effect.fn("MemoryHttpApi.clear")(function* () {
      yield* svc.clear()
      return true
    })

    const configure = Effect.fn("MemoryHttpApi.configure")(function* (ctx: {
      payload: typeof MemoryConfigInput.Type
    }) {
      yield* svc.configure(ctx.payload)
      return true
    })

    const v3Stats = Effect.fn("MemoryHttpApi.v3Stats")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { total: 0, active: 0, archived: 0, due: 0, byKind: {}, rooms: [] }
      return safe(yield* v3.stats(id))
    })

    const v3Nodes = Effect.fn("MemoryHttpApi.v3Nodes")(function* (ctx: {
      query: {
        sessionID?: string
        status?: string
        kind?: string
        room?: string
        query?: string
        limit?: number
        offset?: number
      }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return safe(yield* v3.nodes(id, {
        status: ctx.query.status as never,
        kind: ctx.query.kind as never,
        room: ctx.query.room,
        query: ctx.query.query,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
      }))
    })

    const v3Profile = Effect.fn("MemoryHttpApi.v3Profile")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { current: null, versions: [] }
      return safe(yield* v3.profile(id))
    })

    const v3ProfileSet = Effect.fn("MemoryHttpApi.v3ProfileSet")(function* (ctx: {
      query: { sessionID?: string }
      payload: { content: string }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { version: 0, content: "" }
      return safe(yield* v3.setProfile(id, ctx.payload.content))
    })

    const v3Rooms = Effect.fn("MemoryHttpApi.v3Rooms")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return safe(yield* v3.rooms(id))
    })

    const v3Audit = Effect.fn("MemoryHttpApi.v3Audit")(function* (ctx: {
      query: { sessionID?: string; targetID?: string; limit?: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return safe(yield* v3.audit(id, { targetID: ctx.query.targetID, limit: ctx.query.limit }))
    })

    const v3Suggestions = Effect.fn("MemoryHttpApi.v3Suggestions")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return safe(yield* v3.suggestions(id))
    })

    const v3Reflect = Effect.fn("MemoryHttpApi.v3Reflect")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { created: 0, applied: 0 }
      return safe(yield* v3.reflect(id))
    })

    const v3ReflectDecide = Effect.fn("MemoryHttpApi.v3ReflectDecide")(function* (ctx: {
      query: { sessionID?: string }
      payload: { id: string; action: "accept" | "reject" }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return null
      return safe(yield* v3.decideReflection(id, ctx.payload))
    })

    const v3Export = Effect.fn("MemoryHttpApi.v3Export")(function* (ctx: {
      query: { sessionID?: string; format?: "json" | "markdown" }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return ""
      return yield* v3.exportMemory(id, { format: ctx.query.format ?? "json" })
    })

    const v3Backup = Effect.fn("MemoryHttpApi.v3Backup")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { path: "", bytes: 0 }
      return safe(yield* v3.backup(id))
    })

    const v3Import = Effect.fn("MemoryHttpApi.v3Import")(function* (ctx: {
      query: { sessionID?: string }
      payload: { data: string }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { imported: 0 }
      return yield* v3.importMemory(id, ctx.payload.data).pipe(
        Effect.map((value) => safe(value)),
        Effect.catchCause((cause) => Effect.succeed({ imported: 0, error: Cause.pretty(cause).split("\\n")[0] })),
      )
    })

    const v3RebuildEmbeddings = Effect.fn("MemoryHttpApi.v3RebuildEmbeddings")(function* (ctx: {
      query: { sessionID?: string }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { updated: 0, failed: 0 }
      return safe(yield* v3.rebuildEmbeddings(id))
    })

    const v3Review = Effect.fn("MemoryHttpApi.v3Review")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return safe(yield* v3.review(id, { action: "queue" }))
    })

    const v3ReviewGrade = Effect.fn("MemoryHttpApi.v3ReviewGrade")(function* (ctx: {
      query: { sessionID?: string }
      payload: { id: string; grade: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return null
      return safe(yield* v3.review(id, { action: "grade", id: ctx.payload.id, grade: ctx.payload.grade }))
    })

    const v3Mutate = Effect.fn("MemoryHttpApi.v3Mutate")(function* (ctx: {
      query: { sessionID?: string }
      payload: { id: string; action: "update" | "forget" | "archive" | "restore"; content?: string; importance?: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return null
      return safe(yield* v3.mutate(id, ctx.payload))
    })

    const v3Clear = Effect.fn("MemoryHttpApi.v3Clear")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return false
      yield* v3.backup(id)
      yield* v3.clear(id)
      return true
    })

    const v3Search = Effect.fn("MemoryHttpApi.v3Search")(function* (ctx: {
      query: { sessionID?: string; query: string; room?: string; limit?: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { hits: [], degraded: true }
      return safe(yield* v3.search(id, {
        query: ctx.query.query,
        room: ctx.query.room,
        limit: ctx.query.limit,
      }))
    })

    return handlers
      .handle("get", get)
      .handle("summary", summary)
      .handle("clear", clear)
      .handle("configure", configure)
      .handle("v3Stats", v3Stats)
      .handle("v3Nodes", v3Nodes)
      .handle("v3ProfileGet", v3Profile)
      .handle("v3ProfileSet", v3ProfileSet)
      .handle("v3Rooms", v3Rooms)
      .handle("v3Audit", v3Audit)
      .handle("v3Suggestions", v3Suggestions)
      .handle("v3Reflect", v3Reflect)
      .handle("v3ReflectDecide", v3ReflectDecide)
      .handle("v3Export", v3Export)
      .handle("v3Backup", v3Backup)
      .handle("v3Import", v3Import)
      .handle("v3RebuildEmbeddings", v3RebuildEmbeddings)
      .handle("v3ReviewQueue", v3Review)
      .handle("v3ReviewGrade", v3ReviewGrade)
      .handle("v3Mutate", v3Mutate)
      .handle("v3Clear", v3Clear)
      .handle("v3Search", v3Search)
  }),
)
