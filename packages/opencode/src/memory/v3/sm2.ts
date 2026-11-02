import type { ReviewSchedule } from "./types"

export const MIN_EASE = 1.3
export const INITIAL_EASE = 2.5
export const FIRST_INTERVAL_DAYS = 1
export const SECOND_INTERVAL_DAYS = 6
const DAY_MS = 86_400_000

export function initialSchedule(now: number): ReviewSchedule {
  return { nextReviewAt: now + FIRST_INTERVAL_DAYS * DAY_MS, easeFactor: INITIAL_EASE, intervalDays: 0, reps: 0 }
}

export function nextSchedule(grade: number, state: ReviewSchedule, now: number): ReviewSchedule {
  if (grade < 3) {
    const ease = Math.max(MIN_EASE, state.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
    return { nextReviewAt: now + FIRST_INTERVAL_DAYS * DAY_MS, easeFactor: Math.round(ease * 100) / 100, intervalDays: 1, reps: 0 }
  }
  const reps = state.reps + 1
  const intervalDays =
    reps === 1 ? FIRST_INTERVAL_DAYS : reps === 2 ? SECOND_INTERVAL_DAYS : Math.max(1, Math.round(state.intervalDays * state.easeFactor))
  const ease = Math.max(MIN_EASE, state.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
  return {
    nextReviewAt: now + intervalDays * DAY_MS,
    easeFactor: Math.round(ease * 100) / 100,
    intervalDays,
    reps,
  }
}

export function isDue(schedule: ReviewSchedule, now: number) {
  return schedule.nextReviewAt !== null && schedule.nextReviewAt <= now
}
