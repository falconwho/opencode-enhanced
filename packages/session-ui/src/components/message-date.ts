export function formatMessageDate(created?: number) {
  if (typeof created !== "number" || !Number.isFinite(created)) return ""
  const date = new Date(created)
  if (Number.isNaN(date.getTime())) return ""
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}
