export const MEMORY_SCOPES = ["user", "project", "shared"] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const MEMORY_KINDS = ["fact", "preference", "decision", "episode", "skill"] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_STATUSES = ["proposed", "active", "merged", "needs_review", "archived", "forgotten"] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

export const EDGE_TYPES = ["related", "supports", "refines", "contradicts", "supersedes"] as const
export type EdgeType = (typeof EDGE_TYPES)[number]

export type Slot = {
  room: string
  index: number
}

export type Imagery = {
  caption?: string
  score?: number
}

export type ReviewSchedule = {
  nextReviewAt: number | null
  easeFactor: number
  intervalDays: number
  reps: number
}

export type MemoryNode = {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  content: string
  importance: number
  confidence: number
  status: MemoryStatus
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  sourceSessionID?: string
  sourceRound?: number
  sourceSeq?: number
  outcome?: string
  imagery?: Imagery
  slot?: Slot
  review: ReviewSchedule
}

export type SaveDisposition = "accept" | "merge" | "defer" | "drop"

export type SaveResult = {
  disposition: SaveDisposition
  node?: MemoryNode
  mergedInto?: string
  similarity?: number
  candidates?: MemoryNode[]
  reason?: string
}

export type FactRecord = {
  id: string
  entityId: string
  content: string
  validAt: number
  invalidAt?: number
  replacedBy?: string
  sourceNodeID?: string
}

export type EntityRecord = {
  id: string
  name: string
  kind: string
  aliases: string[]
}

export type ObservationRecord = {
  id: string
  scope: MemoryScope
  belief: string
  status: "active" | "stale" | "refuted"
  sources: string[]
  proofCount: number
  createdAt: number
  updatedAt: number
  lastValidatedAt: number
}

export type MemoryStats = {
  total: number
  active: number
  archived: number
  due: number
  byKind: Record<string, number>
  rooms: Array<{ room: string; count: number }>
}

export type SearchHit = {
  node: MemoryNode
  score: number
  ref: string
  via?: { type: EdgeType; from: string }
}

export const REFLECTION_ACTIONS = ["merge", "supersede", "observe", "link"] as const
export type ReflectionAction = (typeof REFLECTION_ACTIONS)[number]

export const REFLECTION_STATUSES = ["pending", "accepted", "rejected"] as const
export type ReflectionStatus = (typeof REFLECTION_STATUSES)[number]

export type ReflectionSuggestion = {
  id: string
  scope: MemoryScope
  action: ReflectionAction
  sourceIds: string[]
  targetId?: string
  content?: string
  reason?: string
  status: ReflectionStatus
  confidence: number
  createdAt: number
  updatedAt: number
}
