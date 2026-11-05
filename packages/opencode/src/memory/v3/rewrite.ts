import type { SearchHit } from "./types"

export const MAX_REWRITE_QUERIES = 3
export const REWRITE_RRF = 60

export function parseRewrite(value: unknown, maxQueries = MAX_REWRITE_QUERIES): string[] {
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const queries: string[] = []
  for (const item of items) {
    if (typeof item !== "string") continue
    const query = item.replace(/\s+/gu, " ").trim().slice(0, 500)
    if (!query) continue
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(query)
    if (queries.length >= maxQueries) break
  }
  return queries
}

export function parseRewriteOutput(raw: string, maxQueries = MAX_REWRITE_QUERIES): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim()
  const start = cleaned.indexOf("[")
  const end = cleaned.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  try {
    return parseRewrite(JSON.parse(cleaned.slice(start, end + 1)), maxQueries)
  } catch {
    return []
  }
}

export function rewritePrompt(query: string, maxQueries = MAX_REWRITE_QUERIES) {
  return [
    `Rewrite this memory search query into at most ${maxQueries} complementary search queries.`,
    "Return only a JSON string array. Do not answer the query.",
    "Use different wording, synonyms, or narrower angles that could match stored memories.",
    query,
  ].join("\n\n")
}

export function mergeQueryResults(
  retrievals: ReadonlyArray<{ hits: readonly SearchHit[] }>,
  limit: number,
  minPerQuery: number,
) {
  const entries = new Map<string, { hit: SearchHit; score: number; firstRank: number; firstQuery: number }>()
  for (const [queryIndex, retrieval] of retrievals.entries()) {
    for (const [rank, hit] of retrieval.hits.entries()) {
      const add = 1 / (rank + 1 + REWRITE_RRF)
      const existing = entries.get(hit.ref)
      if (!existing) {
        entries.set(hit.ref, { hit, score: add, firstRank: rank, firstQuery: queryIndex })
        continue
      }
      existing.score += add
      existing.firstRank = Math.min(existing.firstRank, rank)
      existing.firstQuery = Math.min(existing.firstQuery, queryIndex)
      if (hit.score > existing.hit.score) existing.hit = hit
    }
  }
  const ranked = [...entries.values()].sort(
    (a, b) => b.score - a.score || a.firstRank - b.firstRank || a.firstQuery - b.firstQuery,
  )
  const perQuery = Math.min(
    minPerQuery,
    Math.max(1, Math.floor(Math.max(0, limit) / Math.max(1, retrievals.length))),
  )
  const reserved = new Set(
    retrievals.flatMap((retrieval) => retrieval.hits.slice(0, perQuery).map((hit) => hit.ref)),
  )
  return [
    ...ranked.filter((entry) => reserved.has(entry.hit.ref)),
    ...ranked.filter((entry) => !reserved.has(entry.hit.ref)),
  ]
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.hit)
}
