import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionReminders } from "@/session/reminders"

const sessionID = "ses_reminders_test"

function userMessage(id = "msg_user", text = "real user input") {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [
      {
        id: `${id}_part`,
        messageID: id,
        sessionID,
        type: "text",
        text,
      },
    ],
  } as unknown as SessionV1.WithParts
}

function assistantMessage(agent = "build", id = "msg_assistant") {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      agent,
    },
    parts: [],
  } as unknown as SessionV1.WithParts
}

function harness() {
  const persisted: SessionV1.Part[] = []
  const sessions = {
    updatePart: (part: SessionV1.Part) =>
      Effect.sync(() => {
        persisted.push(part)
        return part
      }),
  }
  return { persisted, sessions }
}

function run(messages: SessionV1.WithParts[], agent: string, sessions: ReturnType<typeof harness>["sessions"]) {
  return Effect.runPromise(
    SessionReminders.apply({
      messages,
      agent: { name: agent } as never,
      session: {} as never,
    }).pipe(
      Effect.provideService(RuntimeFlags.Service, { experimentalPlanMode: false } as never),
      Effect.provideService(FSUtil.Service, {} as never),
      Effect.provideService(Session.Service, sessions as never),
    ),
  )
}

describe("SessionReminders persistence", () => {
  test("persists the plan reminder on the current user message", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage()]

    await run(messages, "plan", sessions)

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        "opencode-enhanced": { kind: "plan-mode" },
      },
    })
    expect(messages[0]?.parts).toHaveLength(2)
  })

  test("does not add the same plan reminder twice", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage()]

    await run(messages, "plan", sessions)
    await run(messages, "plan", sessions)

    expect(persisted).toHaveLength(1)
    expect(messages[0]?.parts).toHaveLength(2)
  })

  test("keeps the reminder on an older user message for the next turn", async () => {
    const { sessions } = harness()
    const messages = [userMessage("msg_user_a"), assistantMessage("plan")]

    await run(messages, "plan", sessions)

    const user = messages[0]!
    expect(user.parts).toHaveLength(2)
    expect(user.parts[1]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        "opencode-enhanced": { kind: "plan-mode" },
      },
    })
  })

  test("persists the build switch when the history contains a plan assistant", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage("msg_user_a"), assistantMessage("plan"), userMessage("msg_user_b")]

    await run(messages, "build", sessions)

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        "opencode-enhanced": { kind: "build-switch" },
      },
    })
    expect(messages[2]?.parts).toHaveLength(2)
  })

  test("does not add a build switch without a plan assistant", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage("msg_user_a"), assistantMessage("build"), userMessage("msg_user_b")]

    await run(messages, "build", sessions)

    expect(persisted).toHaveLength(0)
  })
})
