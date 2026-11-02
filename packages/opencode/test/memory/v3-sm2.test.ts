import { describe, expect, test } from "bun:test"
import { FIRST_INTERVAL_DAYS, initialSchedule, nextSchedule } from "../../src/memory/v3/sm2"

const DAY = 86_400_000

describe("memory SM-2", () => {
  test("schedules the first review for tomorrow", () => {
    expect(initialSchedule(0).nextReviewAt).toBe(FIRST_INTERVAL_DAYS * DAY)
  })

  test("moves through 1, 6 and ease-scaled intervals", () => {
    const first = nextSchedule(5, initialSchedule(0), 0)
    expect(first.intervalDays).toBe(1)
    const second = nextSchedule(5, first, 0)
    expect(second.intervalDays).toBe(6)
    const third = nextSchedule(5, second, 0)
    expect(third.intervalDays).toBe(16)
  })

  test("resets failed reviews", () => {
    const state = { nextReviewAt: 0, easeFactor: 2.5, intervalDays: 30, reps: 4 }
    expect(nextSchedule(1, state, 0)).toMatchObject({ intervalDays: 1, reps: 0 })
  })
})
