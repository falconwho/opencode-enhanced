import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import {
  CURRENT_DATE_KIND,
  CURRENT_DATE_METADATA_KEY,
  SessionDate,
} from "@/session/date-reminder"

const sessionID = "ses_date_test"
const oct28 = () => new Date("2026-10-28T12:00:00")
const oct29 = () => new Date("2026-10-29T12:00:00")

function userMessage(id = "msg_user", parts: SessionV1.Part[] = []) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts:
      parts.length > 0
        ? parts
        : [
            {
              id: `${id}_part`,
              messageID: id,
              sessionID,
              type: "text",
              text: "real user input",
            },
          ],
  } as unknown as SessionV1.WithParts
}

function assistantMessage(id = "msg_assistant") {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      agent: "build",
    },
    parts: [],
  } as unknown as SessionV1.WithParts
}

function datePart(messageID: string, date: string, id = `${messageID}_date`) {
  return {
    id,
    messageID,
    sessionID,
    type: "text",
    text: `<system-reminder>\nCurrent date: ${date}\n</system-reminder>`,
    synthetic: true,
    metadata: {
      [CURRENT_DATE_METADATA_KEY]: {
        kind: CURRENT_DATE_KIND,
        date,
      },
    },
  } as unknown as SessionV1.Part
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

function run(
  messages: SessionV1.WithParts[],
  sessions: ReturnType<typeof harness>["sessions"],
  now: () => Date,
) {
  return Effect.runPromise(
    SessionDate.apply({
      messages,
      sessions: sessions as never,
      now,
    }),
  )
}

describe("SessionDate", () => {
  test("adds the current date to the first real user message", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage()]

    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        [CURRENT_DATE_METADATA_KEY]: {
          kind: CURRENT_DATE_KIND,
          date: "Thu Oct 29 2026",
        },
      },
    })
    expect(messages[0]?.parts).toHaveLength(2)
  })

  test("does not add a second date part to the same user message", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage()]

    await run(messages, sessions, oct29)
    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(1)
    expect(messages[0]?.parts).toHaveLength(2)
  })

  test("does not modify a user message that already has an assistant reply", async () => {
    const { persisted, sessions } = harness()
    const messages = [userMessage(), assistantMessage()]

    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(0)
    expect(messages[0]?.parts).toHaveLength(1)
  })

  test("does not add a date to a synthetic user message", async () => {
    const { persisted, sessions } = harness()
    const message = userMessage()
    ;(message.info as { synthetic?: boolean }).synthetic = true
    const messages = [message]

    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(0)
    expect(messages[0]?.parts).toHaveLength(1)
  })

  test("adds a new date only to the next user message after a date change", async () => {
    const { persisted, sessions } = harness()
    const first = userMessage("msg_user_a", [
      {
        id: "msg_user_a_part",
        messageID: "msg_user_a",
        sessionID,
        type: "text",
        text: "first",
      } as unknown as SessionV1.Part,
      datePart("msg_user_a", "Wed Oct 28 2026"),
    ])
    const second = userMessage("msg_user_b")
    const messages = [first, assistantMessage(), second]

    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(1)
    expect(first.parts).toHaveLength(2)
    expect(second.parts).toHaveLength(2)
    expect(second.parts[1]).toMatchObject({
      type: "text",
      synthetic: true,
      metadata: {
        [CURRENT_DATE_METADATA_KEY]: {
          kind: CURRENT_DATE_KIND,
          date: "Thu Oct 29 2026",
        },
      },
    })
  })

  test("does not add another date when the date changes during the same user turn", async () => {
    const { persisted, sessions } = harness()
    const message = userMessage("msg_user_a", [
      {
        id: "msg_user_a_part",
        messageID: "msg_user_a",
        sessionID,
        type: "text",
        text: "first",
      } as unknown as SessionV1.Part,
      datePart("msg_user_a", "Wed Oct 28 2026"),
    ])

    await run([message], sessions, oct29)

    expect(persisted).toHaveLength(0)
    expect(message.parts).toHaveLength(2)
  })

  test("does not add a date to a new user on the same day", async () => {
    const { persisted, sessions } = harness()
    const first = userMessage("msg_user_a", [
      {
        id: "msg_user_a_part",
        messageID: "msg_user_a",
        sessionID,
        type: "text",
        text: "first",
      } as unknown as SessionV1.Part,
      datePart("msg_user_a", "Thu Oct 29 2026"),
    ])
    const second = userMessage("msg_user_b")
    const messages = [first, assistantMessage(), second]

    await run(messages, sessions, oct29)

    expect(persisted).toHaveLength(0)
    expect(second.parts).toHaveLength(1)
  })
})

describe("system prompt date", () => {
  test("no longer embeds the current date in the environment block", async () => {
    const source = await Bun.file(new URL("../../src/session/system.ts", import.meta.url)).text()

    expect(source).not.toContain("Today's date")
  })
})
