export function reasoningEfforts(model: { variants?: Record<string, unknown> }) {
  return Object.keys(model.variants ?? {})
}

export function normalizeReasoningEffort(
  model: { variants?: Record<string, unknown>; capabilities: { reasoning: boolean } },
  effort: string | undefined,
) {
  if (!effort || !model.capabilities.reasoning) return undefined
  const efforts = reasoningEfforts(model)
  if (!efforts.length) return effort
  if (efforts.includes(effort)) return effort
  if (efforts.includes("high")) return "high"
  return efforts[0]
}
