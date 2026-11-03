export function shouldStartAtBottom(input: {
  hash?: string
  pendingMessage?: string
  messageId?: string
}) {
  return !input.hash && !input.pendingMessage && !input.messageId
}
