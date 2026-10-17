import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionKeyReader, ensureSessionKey, mergeProjectInfo, pruneSessionKeys } from "./layout-helpers"

describe("mergeProjectInfo", () => {
  test("applies local project metadata for the shared global project", () => {
    const merged = mergeProjectInfo(
      { id: "global", worktree: "/" },
      { name: "My Project", icon: { color: "orange" } },
      { worktree: "D:\\My_OpenCode_Enhanced_Projects", expanded: true },
    )

    expect(merged.name).toBe("My Project")
    expect(merged.icon).toEqual({ color: "orange" })
    expect(merged.worktree).toBe("D:\\My_OpenCode_Enhanced_Projects")
    expect(merged.expanded).toBe(true)
  })

  test("applies local project metadata when the server has no row", () => {
    const merged = mergeProjectInfo(
      undefined,
      { name: "Local Name", icon: { color: "mint" } },
      { worktree: "D:\\projects\\app", expanded: false },
    )

    expect(merged.name).toBe("Local Name")
    expect(merged.icon).toEqual({ color: "mint" })
  })

  test("keeps server metadata authoritative for real projects", () => {
    const merged = mergeProjectInfo(
      { id: "1cae1f4f8d1e", worktree: "D:\\projects\\app", name: "Server Name", icon: { color: "pink" } },
      { name: "Local Name", icon: { color: "mint" } },
      { worktree: "D:\\projects\\app", expanded: false },
    )

    expect(merged.name).toBe("Server Name")
    expect(merged.icon).toEqual({ color: "pink" })
  })
})

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})
