import log from "electron-log/main.js"
import { getStore } from "./store"

const TAURI_MIGRATED_KEY = "tauriMigrated"

// opencode-enhanced: never read or import the original opencode install's
// data directories; strict isolation takes priority over tauri migration.
export function migrate() {
  if (getStore().get(TAURI_MIGRATED_KEY)) return
  log.log("tauri migration: disabled in opencode-enhanced, skipping")
  getStore().set(TAURI_MIGRATED_KEY, true)
}
