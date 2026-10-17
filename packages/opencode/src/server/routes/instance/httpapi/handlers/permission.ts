import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
import { Approval } from "@/permission/approval"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError, ServiceUnavailableError } from "../errors"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const approval = yield* Approval.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionV1.ID }
      payload: PermissionV1.ReplyBody
    }) {
      yield* Effect.logInfo("http.permissionReply", {
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        hasMessage: Boolean(ctx.payload.message),
        message: ctx.payload.message?.slice(0, 120) ?? "",
      })
      yield* svc
        .reply({
          requestID: ctx.params.requestID,
          reply: ctx.payload.reply,
          message: ctx.payload.message,
        })
        .pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      return true
    })

    const aiJudge = Effect.fn("PermissionHttpApi.aiJudge")(function* (ctx: { payload: Approval.JudgeInput }) {
      return yield* approval.judge(ctx.payload).pipe(
        Effect.tapError((error) => Effect.logError("aiJudge failed", { message: error.message })),
        Effect.mapError(
          (error) =>
            new ServiceUnavailableError({
              service: "approval",
              message: `AI approval unavailable: ${error.message}`,
            }),
        ),
      )
    })

    return handlers.handle("list", list).handle("reply", reply).handle("aiJudge", aiJudge)
  }),
)
