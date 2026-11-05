import { cosine, type MemoryStore } from "./store"
import type { MemoryScope, SearchHit } from "./types"

export type SearchStore = {
  scope: MemoryScope
  store: MemoryStore
}

export type SearchInput = {
  query: string
  stores: SearchStore[]
  embedding?: Float32Array
  room?: string
  limit?: number
  touch?: boolean
}

export type SearchResult = {
  hits: SearchHit[]
  degraded: boolean
}

const RRF = 60

export function searchMemory(input: SearchInput): SearchResult {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 50)
  const ranked = new Map<string, { hit: SearchHit; score: number }>()
  let degraded = !input.embedding
  for (const { scope, store } of input.stores) {
    const fts = store.fts(undefined, input.query, limit * 2, input.room)
    fts.forEach((item, index) => {
      const id = `${scope}:${item.node.id}`
      const previous = ranked.get(id)
      const score = 1 / (RRF + index + 1)
      if (previous) previous.score += score
      else
        ranked.set(id, {
          score,
          hit: { node: item.node, score, ref: id },
        })
    })
    const queryEmbedding = input.embedding
    if (queryEmbedding) {
      const vectorHits = store
        .embeddings(input.room)
        .map((item) => ({ id: item.id, similarity: cosine(queryEmbedding, item.vector) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit * 2)
      vectorHits.forEach((item, index) => {
        const node = store.getNode(item.id)
        if (!node) return
        const id = `${scope}:${node.id}`
        const previous = ranked.get(id)
        const score = 1 / (RRF + index + 1)
        if (previous) previous.score += score
        else ranked.set(id, { score, hit: { node, score, ref: id } })
      })
    }
  }
  if (!input.embedding) degraded = true
  const hits = [...ranked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.hit)
  for (const { store } of input.stores) {
    if (input.touch === false) continue
    for (const hit of hits) {
      if (hit.node.scope === store.scope) store.touch(hit.node.id)
    }
  }
  return { hits, degraded }
}
