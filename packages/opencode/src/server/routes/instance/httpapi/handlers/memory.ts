import { Memory } from "@/memory"
import { Service as MemoryV3 } from "@/memory/v3/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { MemoryConfigInput } from "../groups/memory"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Memory.Service
    const v3 = yield* MemoryV3

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
      return yield* v3.stats(id)
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
      return yield* v3.nodes(id, {
        status: ctx.query.status as never,
        kind: ctx.query.kind as never,
        room: ctx.query.room,
        query: ctx.query.query,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
      })
    })

    const v3Profile = Effect.fn("MemoryHttpApi.v3Profile")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { current: undefined, versions: [] }
      return yield* v3.profile(id)
    })

    const v3ProfileSet = Effect.fn("MemoryHttpApi.v3ProfileSet")(function* (ctx: {
      query: { sessionID?: string }
      payload: { content: string }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { version: 0, content: "" }
      return yield* v3.setProfile(id, ctx.payload.content)
    })

    const v3Review = Effect.fn("MemoryHttpApi.v3Review")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return []
      return yield* v3.review(id, { action: "queue" })
    })

    const v3ReviewGrade = Effect.fn("MemoryHttpApi.v3ReviewGrade")(function* (ctx: {
      query: { sessionID?: string }
      payload: { id: string; grade: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return undefined
      return yield* v3.review(id, { action: "grade", id: ctx.payload.id, grade: ctx.payload.grade })
    })

    const v3Mutate = Effect.fn("MemoryHttpApi.v3Mutate")(function* (ctx: {
      query: { sessionID?: string }
      payload: { id: string; action: "update" | "forget" | "archive" | "restore"; content?: string; importance?: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return undefined
      return yield* v3.mutate(id, ctx.payload)
    })

    const v3Clear = Effect.fn("MemoryHttpApi.v3Clear")(function* (ctx: { query: { sessionID?: string } }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return false
      yield* v3.clear(id)
      return true
    })

    const v3Search = Effect.fn("MemoryHttpApi.v3Search")(function* (ctx: {
      query: { sessionID?: string; query: string; room?: string; limit?: number }
    }) {
      const id = yield* resolve(ctx.query.sessionID)
      if (!id) return { hits: [], degraded: true }
      return yield* v3.search(id, {
        query: ctx.query.query,
        room: ctx.query.room,
        limit: ctx.query.limit,
      })
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
      .handle("v3ReviewQueue", v3Review)
      .handle("v3ReviewGrade", v3ReviewGrade)
      .handle("v3Mutate", v3Mutate)
      .handle("v3Clear", v3Clear)
      .handle("v3Search", v3Search)
  }),
)
