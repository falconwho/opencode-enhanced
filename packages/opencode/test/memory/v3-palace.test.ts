import { describe, expect, test } from "bun:test"
import { ROOM_CAPACITY, assignSlot, scorePlacard } from "../../src/memory/v3/palace"

describe("memory palace", () => {
  test("fills nine slots before opening a second room", () => {
    expect(assignSlot("fact", {})).toEqual({ slot: { room: "fact", index: 1 }, openedNewRoom: false })
    expect(assignSlot("fact", { fact: { count: 8, maxIndex: 8 } })).toEqual({
      slot: { room: "fact", index: 9 },
      openedNewRoom: false,
    })
    expect(assignSlot("fact", { fact: { count: ROOM_CAPACITY, maxIndex: 9 } })).toEqual({
      slot: { room: "fact-2", index: 1 },
      openedNewRoom: true,
    })
  })

  test("does not recycle the highest slot index", () => {
    expect(assignSlot("fact", { fact: { count: 2, maxIndex: 9 } }).slot.index).toBe(10)
  })

  test("scores unique date anchored placards", () => {
    expect(
      scorePlacard({
        content: "2026-11-02 memory palace decision",
        createdAt: 1,
        allContents: ["2026-11-02 memory palace decision"],
        roomContents: [],
      }),
    ).toBe(1)
  })
})
