import { batch, createMemo, createSignal, startTransition } from "solid-js"
import { useParams } from "@solidjs/router"
import { useModels } from "@/context/models"
import type { ModelKey, ModelSelection } from "@/context/local"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/context/model-variant"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { resolveDefaultModel } from "@/hooks/provider-catalog"
import { showToast } from "@/utils/toast"

// opencode-enhanced: model-switch compaction notice shown in the composer.
export const [compactingNote, setCompactingNote] = createSignal<string>()

export function createPromptModelSelection(input: { agent: () => { model?: ModelKey; variant?: string } | undefined }) {
  const sdk = useSDK()
  const sync = useSync()
  const models = useModels()
  const prompt = usePrompt()
  const providers = useProviders(() => sdk().directory)
  const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))
  const params = useParams()

  // opencode-enhanced: estimate current context from the last assistant usage.
  const currentContextTokens = () => {
    const id = params.id
    if (!id) return 0
    const messages = sync().data.message[id] ?? []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message?.role !== "assistant") continue
      const tokens = message.tokens
      if (!tokens) continue
      const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
      if (total > 0) return total
    }
    return 0
  }

  // opencode-enhanced: compact the session with the newly selected model so a
  // conversation that outgrew the new model's context window stays usable.
  const compactForModel = async (sessionID: string, model: ModelKey, limit: number, total: number) => {
    setCompactingNote(
      `当前对话上下文约 ${Math.round(total / 1000)}k tokens，超过新模型 ${model.modelID} 的 ${Math.round(limit / 1000)}k 限制，正在压缩上下文以适配新模型…`,
    )
    try {
      await sdk().api.session.compact({
        sessionID,
        model: { providerID: model.providerID, modelID: model.modelID },
      })
    } catch (error) {
      console.error("[model-switch] compact failed", error)
      showToast({
        title: "上下文压缩失败",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setCompactingNote(undefined)
    }
  }

  const valid = (model: ModelKey) => {
    const provider = providers.all().get(model.providerID)
    return !!provider?.models[model.modelID] && connected().has(model.providerID)
  }

  const configured = () => {
    const model = resolveDefaultModel(providers.defaultModel(), sync().data.config.model)
    if (!model) return
    if (valid(model)) return model
  }

  const recent = () => models.recent.list().find(valid)
  const fallback = () => {
    const defaults = providers.default()
    return providers.connected().flatMap((provider) => {
      const modelID = defaults[provider.id] ?? Object.values(provider.models)[0]?.id
      return modelID ? [{ providerID: provider.id, modelID }] : []
    })[0]
  }

  const current = () => {
    const key = [prompt.model.current(), input.agent()?.model, configured(), recent(), fallback()].find(
      (item): item is ModelKey => !!item && valid(item),
    )
    if (!key) return
    return models.find(key)
  }
  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )

  const selection = {
    ready: models.ready,
    current,
    recent: recentModels,
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()
      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)
      if (index === -1) return
      const next = items[(index + direction + items.length) % items.length]
      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      const previous = current()
      startTransition(() =>
        batch(() => {
          prompt.model.set(item ? { ...item, variant: prompt.model.current()?.variant } : undefined)
          if (!item) return
          models.setVisibility(item, true)
          if (options?.recent) models.recent.push(item)
        }),
      )
      // opencode-enhanced: switching models inside an existing conversation -
      // if the current context already exceeds the new model's context limit,
      // compact the session first so the new model can actually run.
      if (item && previous && (previous.provider.id !== item.providerID || previous.id !== item.modelID)) {
        const model = models.find(item)
        const limit = model?.limit?.context
        if (limit && params.id) {
          const total = currentContextTokens()
          if (total > limit * 0.9) {
            void compactForModel(params.id, item, limit, total)
          }
        }
      }
    },
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured() {
        const item = input.agent()
        const model = current()
        if (!item || !model) return
        return getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      },
      selected() {
        return prompt.model.current()?.variant
      },
      current() {
        const resolved = resolveModelVariant({
          variants: this.list(),
          selected: this.selected(),
          configured: this.configured(),
        })
        if (resolved) return resolved
        const model = current()
        if (!model) return
        const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
        if (saved && this.list().includes(saved)) return saved
      },
      list() {
        return Object.keys(current()?.variants ?? {})
      },
      set(value: string | undefined) {
        startTransition(() =>
          batch(() => {
            const model = current()
            if (!model) return
            prompt.model.set({ providerID: model.provider.id, modelID: model.id, variant: value ?? null })
            models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          }),
        )
      },
      cycle() {
        const variants = this.list()
        if (variants.length === 0) return
        this.set(
          cycleModelVariant({
            variants,
            selected: this.selected(),
            configured: this.configured(),
          }),
        )
      },
    },
  } satisfies ModelSelection

  return selection
}
