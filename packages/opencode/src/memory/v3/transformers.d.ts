declare module "@huggingface/transformers" {
  export const env: { cacheDir: string; allowRemoteModels: boolean }
  export function pipeline(
    task: string,
    model: string,
    options: { dtype: string },
  ): Promise<(texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>>
}
