type PromptPart = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

const CONTINUATIONS = new Set([
  "继续",
  "继续吧",
  "继续做",
  "继续完成",
  "继续干",
  "接着",
  "接着吧",
  "接着做",
  "接着干",
  "往下做",
  "continue",
  "resume",
  "go on",
  "keep going",
  "carry on",
])

export function isContinuationPrompt(parts: readonly PromptPart[]) {
  if (parts.length === 0) return false
  if (parts.some((part) => part.type !== "text" || part.synthetic || part.ignored)) return false
  const text = parts.map((part) => part.text ?? "").join(" ").trim()
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/^[\s.,!?;:，。！？；：、]+/, "")
    .replace(/[\s.,!?;:，。！？；：、]+$/, "")
    .toLowerCase()
  return CONTINUATIONS.has(normalized)
}
