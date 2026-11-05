import { describe, expect, test } from "bun:test"
import { mergeQueryResults, parseRewriteOutput } from "../../src/memory/v3/rewrite"
import type { SearchHit } from "../../src/memory/v3/types"

const hit = (ref: string, score: number): SearchHit =>
  ({
    ref,
    score,
    node: { id: ref, scope: "user", status: "active" },
  }) as SearchHit

describe("memory v3 query rewrite", () => {
  test("normalizes and deduplicates rewritten queries", () => {
    expect(parseRewriteOutput(JSON.stringify([" Factor  Backtest ", "factor backtest", "回测报错", "third", "fourth"]))).toEqual([
      "Factor Backtest",
      "回测报错",
      "third",
    ])
  })

  test("merges query results with RRF and keeps per-query reserves", () => {
    const merged = mergeQueryResults(
      [
        { hits: [hit("a", 1), hit("b", 0.9)] },
        { hits: [hit("c", 1), hit("a", 0.8)] },
      ],
      5,
      1,
    )
    expect(merged.map((item) => item.ref)).toEqual(["a", "c", "b"])
  })
})
