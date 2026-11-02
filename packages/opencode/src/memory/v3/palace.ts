import type { MemoryKind, Slot } from "./types"

export const ROOM_CAPACITY = 9

export const KIND_ROOM_IDS: Record<MemoryKind, string> = {
  fact: "fact",
  preference: "preference",
  decision: "decision",
  episode: "episode",
  skill: "skill",
}

export type RoomOccupancy = {
  count: number
  maxIndex: number
}

export function assignSlot(kind: MemoryKind, occupancy: Record<string, RoomOccupancy>): { slot: Slot; openedNewRoom: boolean } {
  const base = KIND_ROOM_IDS[kind]
  for (let n = 1; ; n += 1) {
    const room = n === 1 ? base : `${base}-${n}`
    const state = occupancy[room]
    if (!state) return { slot: { room, index: 1 }, openedNewRoom: n > 1 }
    if (state.count < ROOM_CAPACITY) return { slot: { room, index: state.maxIndex + 1 }, openedNewRoom: false }
  }
}

export function scorePlacard(input: {
  content: string
  createdAt: number
  allContents: readonly string[]
  roomContents: readonly string[]
}) {
  let score = 0
  if (input.allContents.filter((item) => item === input.content).length <= 1) score += 0.4
  if (/\b(19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b(19|20)\d{2}\b/.test(input.content)) score += 0.3
  const prefix = input.content.slice(0, 6)
  if (input.roomContents.filter((item) => item.slice(0, 6) === prefix).length <= 1) score += 0.3
  return Math.round(score * 100) / 100
}

export function roomLabel(room: string) {
  return room
}
