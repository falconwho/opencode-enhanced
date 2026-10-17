import type { Plugin } from "@opencode-ai/plugin"

// opencode-enhanced F5: expand session references in the outgoing user
// message into a digest of the referenced session (title + recent messages).
// Two formats are supported:
//   - codex-style markdown links  [标题](oc://renderer/<base64-dir>/session/<id>)
//     The link text is kept as-is (the model sees the conversation link),
//     and a digest is appended right after it.
//   - legacy tokens  @session:<id>  (kept for old stored messages)
// Runs as a chat.messages.transform hook so the stored user text stays
// readable while the model receives the digest.
const MAX_REF_CHARS = 4000
const MAX_MESSAGES = 10

const SESSION_LINK_RE = /\[[^\]]+\]\(oc:\/\/renderer\/[^)]+\/session\/([A-Za-z0-9_-]+)\)/g
const SESSION_TOKEN_RE = /@session:([A-Za-z0-9_-]+)/g

export const SessionReferencePlugin: Plugin = async ({ client }) => {
  async function digest(sessionID: string): Promise<string> {
    try {
      const [info, msgs] = await Promise.all([
        client.session.get({ path: { id: sessionID } }),
        client.session.messages({ path: { id: sessionID }, query: { limit: MAX_MESSAGES * 4 } }),
      ])
      const title = (info as { data?: { title?: string } }).data?.title ?? "untitled"
      const data = (msgs as { data?: { info: { role: string }; parts: { type: string; text?: string; synthetic?: boolean }[] }[] }).data ?? []
      const lines = data
        .filter((message) => message.info.role === "user" || message.info.role === "assistant")
        .slice(-MAX_MESSAGES)
        .map((message) => {
          const text = message.parts
            .filter((part) => part.type === "text" && !part.synthetic)
            .map((part) => part.text ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300)
          return text ? `${message.info.role}: ${text}` : undefined
        })
        .filter((line): line is string => !!line)
      return `<referenced-session id="${sessionID}" title="${title}">\n${lines.join("\n").slice(0, MAX_REF_CHARS)}\n</referenced-session>`
    } catch {
      return `<referenced-session id="${sessionID}">(referenced session unavailable)</referenced-session>`
    }
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const last = [...output.messages].reverse().find((message) => message.info.role === "user")
      if (!last) return
      for (const part of last.parts) {
        if (part.type !== "text") continue
        const text = "text" in part ? (part.text as string) : undefined
        if (!text || (!text.includes("@session:") && !text.includes("oc://renderer/"))) continue
        let next = text
        for (const ref of text.matchAll(SESSION_LINK_RE)) {
          if (ref[1] === last.info.sessionID) continue
          next = next.replace(ref[0], `${ref[0]}\n${await digest(ref[1])}`)
        }
        for (const ref of text.matchAll(SESSION_TOKEN_RE)) {
          if (ref[1] === last.info.sessionID) continue
          next = next.replace(ref[0], await digest(ref[1]))
        }
        if (next !== text) part.text = next
      }
    },
  }
}
