// opencode-enhanced: plugin list labels for the status popover.
// Plugin config entries are usually absolute file:// URLs (the server resolves
// relative paths before exposing the config), so show only the final file name
// without its code extension to keep the list readable. Non-path entries
// (npm-style package names) are returned unchanged.

const CODE_EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i
const PATH_PREFIX = /^([a-zA-Z]:[\\/]|[.\\/]|file:|https?:)/i

export function pluginLabel(value: string): string {
  const raw = value.trim()
  if (!raw) return raw
  const pathLike =
    PATH_PREFIX.test(raw) || raw.includes("\\") || (!raw.startsWith("@") && raw.includes("/") && CODE_EXT.test(raw))
  if (!pathLike) return raw
  let path = raw
  if (/^file:\/\//i.test(raw)) {
    try {
      path = decodeURIComponent(new URL(raw).pathname)
    } catch {
      // keep the raw value when the URL cannot be parsed or decoded
    }
  }
  const base = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  return base.replace(CODE_EXT, "") || base
}
