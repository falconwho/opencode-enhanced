import fs from "node:fs/promises"
import { modelCacheRoot } from "./paths"

export const LOCAL_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
export const LOCAL_DIMENSIONS = 384

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>

let cached: Promise<Extractor | undefined> | undefined

export async function localExtractor() {
  if (!cached) {
    cached = load().catch((error) => {
      cached = undefined
      throw error
    })
  }
  return cached
}

async function load() {
  await fs.mkdir(modelCacheRoot(), { recursive: true })
  const mod = (await import("@huggingface/transformers")) as {
    pipeline: (task: string, model: string, options: { dtype: string }) => Promise<Extractor>
    env: { cacheDir: string; allowRemoteModels: boolean }
  }
  mod.env.cacheDir = modelCacheRoot()
  return mod.pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" })
}

export async function embed(texts: string[]) {
  const extractor = await localExtractor()
  if (!extractor) return
  if (!texts.length) return []
  const output = await extractor(texts, { pooling: "mean", normalize: true })
  return output.tolist().map((list) => new Float32Array(list))
}
