export function isOverLineLimit(input: { scrollHeight: number; lineHeight: number; limit?: number }) {
  const limit = input.limit ?? 10
  if (!Number.isFinite(input.lineHeight) || input.lineHeight <= 0) return false
  return input.scrollHeight > input.lineHeight * limit + 0.5
}
