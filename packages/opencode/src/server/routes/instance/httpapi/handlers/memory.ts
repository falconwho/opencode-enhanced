import { Memory } from "@/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { MemoryConfigInput } from "../groups/memory"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Memory.Service

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

    return handlers.handle("get", get).handle("summary", summary).handle("clear", clear).handle("configure", configure)
  }),
)
