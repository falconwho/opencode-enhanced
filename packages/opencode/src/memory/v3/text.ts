const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u

export function searchText(value: string) {
  const text = value.normalize("NFKC").toLowerCase()
  const tokens = new Set<string>()
  for (const item of text.match(/[a-z0-9_]{2,}/g) ?? []) tokens.add(item)
  for (const run of text.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) ?? []) {
    for (let i = 0; i < run.length; i += 1) {
      tokens.add(run[i]!)
      if (i + 1 < run.length) tokens.add(run.slice(i, i + 2))
    }
  }
  return [...tokens].join(" ")
}

export function queryTerms(value: string) {
  const text = value.normalize("NFKC").toLowerCase()
  const tokens = new Set<string>()
  for (const item of text.match(/[a-z0-9_]{2,}/g) ?? []) tokens.add(item)
  for (const run of text.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) ?? []) {
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2))
    if (run.length === 1) tokens.add(run)
  }
  return [...tokens].slice(0, 32)
}

export function ftsQuery(value: string) {
  const terms = queryTerms(value)
  if (!terms.length) return
  return terms.map((term) => `"${term.replaceAll('"', "")}"`).join(" OR ")
}

export function hasCjk(value: string) {
  return CJK.test(value)
}
