import { describe, expect, test } from "bun:test"
import { pluginLabel } from "./plugin-display"

describe("pluginLabel", () => {
  test("keeps only the file name from relative paths", () => {
    expect(pluginLabel("./plugins/utf8-shell.js")).toBe("utf8-shell")
    expect(pluginLabel("./plugins/webfetch-guard.js")).toBe("webfetch-guard")
    expect(pluginLabel("./superpowers/.opencode/plugins/superpowers.js")).toBe("superpowers")
    expect(pluginLabel("plugins/extra.js")).toBe("extra")
  })

  test("decodes file:// URLs", () => {
    expect(pluginLabel("file:///C:/Users/kylew/.config/opencode_enhanced/plugins/utf8-shell.js")).toBe("utf8-shell")
    expect(pluginLabel("file:///C:/Users/kylew/.config/opencode%20enhanced/plugins/webfetch-guard.mjs")).toBe(
      "webfetch-guard",
    )
  })

  test("handles absolute and windows-style paths", () => {
    expect(pluginLabel("C:\\config\\plugins\\helper.ts")).toBe("helper")
    expect(pluginLabel("D:/x/y/thing.cjs")).toBe("thing")
    expect(pluginLabel("/usr/local/plugins/tool.jsx")).toBe("tool")
  })

  test("keeps npm-style names untouched", () => {
    expect(pluginLabel("opencode-gitlab-auth")).toBe("opencode-gitlab-auth")
    expect(pluginLabel("@scope/plugin")).toBe("@scope/plugin")
  })

  test("never returns an empty display name for a non-empty path", () => {
    expect(pluginLabel("file:///tmp/.js")).toBe(".js")
  })

  test("returns empty input unchanged", () => {
    expect(pluginLabel("")).toBe("")
    expect(pluginLabel("   ")).toBe("")
  })
})
