import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

// opencode-enhanced: single fixed identity, isolated from upstream "OpenCode".
test("uses the enhanced identity everywhere", async () => {
  const module = await import("./electron-builder.config.ts?enhanced")
  const config = module.default as Configuration

  expect(config.appId).toBe("ai.opencode.desktop.enhanced")
  expect(config.productName).toBe("opencode Enhanced")
  expect(config.artifactName).toBe("opencode-enhanced-${os}-${arch}.${ext}")
  expect(config.extraMetadata?.desktopName).toBe("ai.opencode.desktop.enhanced.desktop")
  expect(config.protocols?.schemes).toEqual(["opencode-enhanced"])
})

test("never publishes to upstream update feeds", async () => {
  const module = await import("./electron-builder.config.ts?enhanced-publish")
  const config = module.default as Configuration

  expect(config.publish).toBeUndefined()
})

test("targets Windows NSIS only", async () => {
  const module = await import("./electron-builder.config.ts?enhanced-win")
  const config = module.default as Configuration

  expect(config.win?.target).toEqual(["nsis"])
  expect(config.mac).toBeUndefined()
  expect(config.linux).toBeUndefined()
})

test("does not bundle the CLI", async () => {
  const module = await import("./electron-builder.config.ts?enhanced-cli")
  const config = module.default as Configuration

  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).not.toContainEqual({
    from: "resources/",
    to: "",
    filter: ["opencode-cli*"],
  })
})
