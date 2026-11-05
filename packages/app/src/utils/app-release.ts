const fallbackEnhancedRelease = "1.15.4"

export function appRelease(version: string | undefined, release = import.meta.env?.VITE_OPENCODE_ENHANCED_RELEASE) {
  const current = (version ?? "unknown").replace(/^v/, "")
  const enhanced = release?.match(/^v?\d+\.\d+\.\d+-enhanced\.(.+)$/)?.[1] ?? fallbackEnhancedRelease
  return {
    name: `v${current} OpenCode Enhanced`,
    enhanced,
  }
}
