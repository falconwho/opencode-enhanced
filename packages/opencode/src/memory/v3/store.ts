import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { assignSlot, scorePlacard } from "./palace"
import { migrate } from "./schema"
import { initialSchedule, nextSchedule } from "./sm2"
import { openSqlite, type SqlDatabase } from "./sqlite"
import { sanitizeMemory } from "./security"
import { ftsQuery, searchText } from "./text"
import type {
  EdgeType,
  EntityRecord,
  FactRecord,
  Imagery,
  MemoryKind,
  MemoryNode,
  MemoryScope,
  MemoryStats,
  MemoryStatus,
  ObservationRecord,
  ReviewSchedule,
  SaveResult,
  Slot,
} from "./types"

type Row = Record<string, unknown>

export type SaveInput = {
  kind: MemoryKind
  content: string
  scope: MemoryScope
  importance?: number
  confidence?: number
  sourceSessionID?: string
  sourceRound?: number
  sourceSeq?: number
  embedding?: Float32Array
  placard?: string
  entities?: Array<{ name: string; kind?: string; aliases?: string[] }>
  autoSlot?: boolean
  reviewScheduling?: boolean
  now?: number
}

export type StoreOptions = {
  autoSlot?: boolean
  reviewScheduling?: boolean
  mergeThreshold?: number
  deferThreshold?: number
}

export class MemoryStore {
  private constructor(
    private readonly db: SqlDatabase,
    readonly scope: MemoryScope,
    private readonly options: StoreOptions,
  ) {}

  static async open(file: string, scope: MemoryScope, options: StoreOptions = {}) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const db = await openSqlite(file)
    migrate(db)
    return new MemoryStore(db, scope, {
      autoSlot: options.autoSlot ?? true,
      reviewScheduling: options.reviewScheduling ?? true,
      mergeThreshold: options.mergeThreshold ?? 0.92,
      deferThreshold: options.deferThreshold ?? 0.84,
    })
  }

  close() {
    this.db.close()
  }

  save(input: SaveInput): SaveResult {
    const now = input.now ?? Date.now()
    const content = sanitizeMemory(input.content).trim()
    if (content.length < 4 || /^[\s\p{P}\p{S}]+$/u.test(content)) return { disposition: "drop", reason: "empty-after-sanitize" }
    const contentHash = digest(content)
    return this.transaction(() => {
      const exact = this.db
        .prepare("SELECT * FROM nodes WHERE content_hash = ? AND status = 'active' ORDER BY last_accessed_at DESC LIMIT 1")
        .get(contentHash) as Row | undefined
      if (exact) return this.merge(exact, now)

      const similar = input.embedding ? this.similar(content, input.embedding) : undefined
      if (similar && similar.similarity >= this.options.mergeThreshold!) return this.merge(similar.row, now, similar.similarity)
      const deferred = similar && similar.similarity >= this.options.deferThreshold! ? similar : undefined

      const id = `mem_${randomUUID()}`
      const occupancy = this.occupancy()
      const slot = (input.autoSlot ?? this.options.autoSlot!) ? assignSlot(input.kind, occupancy).slot : undefined
      const imagery = this.imagery(content, input.placard, now, slot)
      const schedule = (input.reviewScheduling ?? this.options.reviewScheduling!) ? initialSchedule(now) : undefined
      const status: MemoryStatus = deferred ? "needs_review" : "active"
      const confidence = input.confidence ?? (deferred ? 0.5 : 0.7)
      this.insertNode({
        id,
        scope: input.scope,
        kind: input.kind,
        content,
        contentHash,
        importance: input.importance ?? 0.5,
        confidence,
        status,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        sourceSessionID: input.sourceSessionID,
        sourceRound: input.sourceRound,
        sourceSeq: input.sourceSeq,
        embedding: input.embedding,
        imagery,
        slot,
        schedule,
      })
      if (slot) this.appendRoute(id)
      if (input.entities?.length) this.linkEntities(id, input.entities, now)
      if (deferred) this.edge(id, deferred.row.id as string, "contradicts", now)
      this.log(status === "needs_review" ? "save-defer" : "save", id, { kind: input.kind, scope: input.scope })
      return {
        disposition: status === "needs_review" ? ("defer" as const) : ("accept" as const),
        node: this.getNode(id)!,
        ...(deferred ? { candidates: [this.rowNode(deferred.row)], similarity: deferred.similarity } : {}),
      }
    })
  }

  getNode(id: string) {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined
    return row ? this.rowNode(row) : undefined
  }

  getNodes(ids: string[]) {
    if (!ids.length) return []
    const placeholders = ids.map(() => "?").join(",")
    return (this.db.prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`).all(...ids) as Row[]).map((row) =>
      this.rowNode(row),
    )
  }

  meta(key: string) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
  }
  embeddings(room?: string): Array<{ id: string; vector: Float32Array }> {
    const rows = this.db
      .prepare(
        `SELECT id, embedding FROM nodes WHERE status = 'active' AND embedding IS NOT NULL ${room ? "AND slot_room = ?" : ""}`,
      )
      .all(...(room ? [room] : [])) as Row[]
    return rows.flatMap((row) => {
      const vector = this.bytesToVector(row.embedding as Uint8Array)
      return vector ? [{ id: row.id as string, vector }] : []
    })
  }

  activeNodes() {
    return (this.db.prepare("SELECT * FROM nodes WHERE status = 'active'").all() as Row[]).map((row) => this.rowNode(row))
  }

  fts(nodeIDs: string[] | undefined, query: string, limit: number, room?: string) {
    const match = ftsQuery(query)
    if (!match) return []
    const rows = this.db
      .prepare(
        `SELECT n.*, bm25(nodes_fts) AS rank
         FROM nodes_fts JOIN nodes n ON n.id = nodes_fts.node_id
         WHERE nodes_fts MATCH ? AND n.status = 'active' ${room ? "AND n.slot_room = ?" : ""}
         ORDER BY rank LIMIT ?`,
      )
      .all(...(room ? [match, room, limit] : [match, limit])) as Row[]
    return rows
      .filter((row) => !nodeIDs || nodeIDs.includes(row.id as string))
      .map((row) => ({ node: this.rowNode(row), rank: Number(row.rank) }))
  }

  touch(id: string, now = Date.now()) {
    this.db
      .prepare("UPDATE nodes SET access_count = access_count + 1, last_accessed_at = ?, confidence = MIN(1, confidence + 0.05) WHERE id = ?")
      .run(now, id)
  }

  update(id: string, input: { content?: string; kind?: MemoryKind; importance?: number; placard?: string; now?: number }) {
    const now = input.now ?? Date.now()
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined
      if (!row) return
      const content = input.content ? sanitizeMemory(input.content).trim() : (row.content as string)
      const contentHash = digest(content)
      this.db
        .prepare("INSERT INTO nodes_revisions (node_id, content, kind, importance, superseded_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, row.content, row.kind, row.importance, now)
      this.db
        .prepare("UPDATE nodes SET content = ?, content_hash = ?, kind = ?, importance = ?, imagery_json = ?, imagery_score = ? WHERE id = ?")
        .run(
          content,
          contentHash,
          input.kind ?? row.kind,
          input.importance ?? row.importance,
          input.placard ? JSON.stringify({ caption: input.placard, score: row.imagery_score }) : row.imagery_json,
          input.placard ? this.imageryScore(content, input.placard, row.slot_room as string | null) : row.imagery_score,
          id,
        )
      this.db.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(id)
      this.db.prepare("INSERT INTO nodes_fts (node_id, search_text) VALUES (?, ?)").run(id, searchText(content))
      this.log("update", id, { content: content.slice(0, 200) })
      return this.getNode(id)
    })
  }

  setStatus(id: string, status: MemoryStatus) {
    this.db.prepare("UPDATE nodes SET status = ? WHERE id = ?").run(status, id)
    this.log(status, id)
  }

  edge(from: string, to: string, type: EdgeType, now = Date.now()) {
    this.db
      .prepare("INSERT OR IGNORE INTO edges (from_id, to_id, type, created_at) VALUES (?, ?, ?, ?)")
      .run(from, to, type, now)
  }

  neighbors(id: string, hops = 1) {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE walk(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT CASE WHEN e.from_id = walk.id THEN e.to_id ELSE e.from_id END, walk.depth + 1
          FROM edges e JOIN walk ON (e.from_id = walk.id OR e.to_id = walk.id)
          WHERE walk.depth < ?
        ) SELECT id FROM walk WHERE depth > 0`,
      )
      .all(id, Math.max(1, hops)) as Array<{ id: string }>
    return this.getNodes(rows.map((row) => row.id))
  }

  timeline(input: { since?: number; until?: number; limit?: number; order?: "recent" | "tour"; room?: string }) {
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes WHERE status != 'forgotten'
         ${input.since ? "AND created_at >= ?" : ""} ${input.until ? "AND created_at <= ?" : ""}
         ${input.room ? "AND slot_room = ?" : ""}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(
        ...([
          ...(input.since ? [input.since] : []),
          ...(input.until ? [input.until] : []),
          ...(input.room ? [input.room] : []),
          input.limit ?? 50,
        ] as unknown[]),
      ) as Row[]
    const nodes = rows.map((row) => this.rowNode(row))
    if (input.order !== "tour") return nodes
    const positions = new Map(
      (this.db.prepare("SELECT position, node_id FROM tour_routes ORDER BY position").all() as Array<{
        position: number
        node_id: string
      }>).map((row) => [row.node_id, row.position]),
    )
    return nodes.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }

  route() {
    return this.db
      .prepare("SELECT position, node_id FROM tour_routes ORDER BY position")
      .all() as Array<{ position: number; node_id: string }>
  }

  stats(now = Date.now()): MemoryStats {
    const byKind = Object.fromEntries(
      (this.db.prepare("SELECT kind, COUNT(*) AS n FROM nodes GROUP BY kind").all() as Array<{ kind: string; n: number }>).map(
        (row) => [row.kind, row.n],
      ),
    )
    const total = Number((this.db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n)
    const active = Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE status = 'active'").get() as { n: number }).n,
    )
    const archived = Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE status IN ('archived','forgotten')").get() as { n: number }).n,
    )
    const due = Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE next_review_at IS NOT NULL AND next_review_at <= ?").get(now) as { n: number }).n,
    )
    const rooms = (this.db.prepare("SELECT slot_room AS room, COUNT(*) AS count FROM nodes WHERE status = 'active' AND slot_room IS NOT NULL GROUP BY slot_room ORDER BY slot_room").all() as Array<{
      room: string
      count: number
    }>)
    return { total, active, archived, due, byKind, rooms }
  }

  reviewQueue(now = Date.now(), limit = 20) {
    return (this.db
      .prepare("SELECT * FROM nodes WHERE status = 'active' AND next_review_at IS NOT NULL AND next_review_at <= ? ORDER BY next_review_at LIMIT ?")
      .all(now, limit) as Row[]).map((row) => this.rowNode(row))
  }

  gradeReview(id: string, grade: number, now = Date.now()) {
    const node = this.getNode(id)
    if (!node) return
    const next = nextSchedule(grade, node.review, now)
    this.db
      .prepare("UPDATE nodes SET next_review_at = ?, ease_factor = ?, interval_days = ?, review_reps = ?, last_accessed_at = ? WHERE id = ?")
      .run(next.nextReviewAt, next.easeFactor, next.intervalDays, next.reps, now, id)
    this.log("review", id, { grade, interval: next.intervalDays })
    return next
  }

  list(input: { status?: MemoryStatus; kind?: MemoryKind; room?: string; query?: string; limit?: number; offset?: number } = {}) {
    const conditions = ["1 = 1"]
    const params: unknown[] = []
    if (input.status) {
      conditions.push("status = ?")
      params.push(input.status)
    }
    if (input.kind) {
      conditions.push("kind = ?")
      params.push(input.kind)
    }
    if (input.room) {
      conditions.push("slot_room = ?")
      params.push(input.room)
    }
    if (input.query) {
      conditions.push("(content LIKE ? OR content_hash = ?)")
      params.push(`%${input.query}%`, digest(input.query))
    }
    params.push(Math.min(Math.max(input.limit ?? 50, 1), 200), input.offset ?? 0)
    return (this.db
      .prepare(`SELECT * FROM nodes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params) as Row[]).map((row) => this.rowNode(row))
  }

  profile(scope: string) {
    const row = this.db.prepare("SELECT * FROM profile_blocks WHERE scope = ?").get(scope) as Row | undefined
    return row ? { content: row.content as string, version: Number(row.version), updatedAt: Number(row.updated_at) } : undefined
  }

  setProfile(scope: string, content: string, source = "user", now = Date.now()) {
    const current = this.profile(scope)
    const version = (current?.version ?? 0) + 1
    const clean = sanitizeMemory(content)
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO profile_blocks (scope, content, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET content = excluded.content, version = excluded.version, updated_at = excluded.updated_at")
        .run(scope, clean, version, now)
      this.db
        .prepare("INSERT INTO profile_block_versions (scope, version, content, source, at) VALUES (?, ?, ?, ?, ?)")
        .run(scope, version, clean, source, now)
      this.log("profile", scope, { version, source })
    })
    return { version, content: clean }
  }

  profileVersions(scope: string) {
    return this.db
      .prepare("SELECT version, content, source, at FROM profile_block_versions WHERE scope = ? ORDER BY version DESC")
      .all(scope) as Array<{ version: number; content: string; source: string; at: number }>
  }

  resolveEntity(input: { name: string; kind?: string; aliases?: string[] }, now = Date.now()): EntityRecord {
    const name = input.name.trim()
    if (!name) throw new Error("entity name is required")
    const rows = this.db.prepare("SELECT * FROM entities").all() as Row[]
    const existing = rows.find((row) => {
      if (row.name === name) return true
      const aliases = JSON.parse(row.aliases_json as string) as string[]
      return aliases.includes(name)
    })
    if (existing) {
      const aliases = new Set([...(JSON.parse(existing.aliases_json as string) as string[]), ...(input.aliases ?? [])])
      this.db.prepare("UPDATE entities SET aliases_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify([...aliases]), now, existing.id)
      return { id: existing.id as string, name: existing.name as string, kind: existing.kind as string, aliases: [...aliases] }
    }
    const entity: EntityRecord = {
      id: `ent_${randomUUID()}`,
      name,
      kind: input.kind ?? "other",
      aliases: input.aliases ?? [],
    }
    this.db
      .prepare("INSERT INTO entities (id, name, kind, aliases_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entity.id, entity.name, entity.kind, JSON.stringify(entity.aliases), now, now)
    return entity
  }

  linkEntities(nodeID: string, mentions: Array<{ name: string; kind?: string; aliases?: string[] }>, now = Date.now()) {
    for (const mention of mentions) {
      const entity = this.resolveEntity(mention, now)
      this.db.prepare("INSERT OR IGNORE INTO node_entities (node_id, entity_id) VALUES (?, ?)").run(nodeID, entity.id)
    }
  }

  entitiesOfNode(nodeIDs: string[]) {
    if (!nodeIDs.length) return new Map<string, EntityRecord[]>()
    const placeholders = nodeIDs.map(() => "?").join(",")
    const rows = this.db
      .prepare(
        `SELECT ne.node_id, e.* FROM node_entities ne JOIN entities e ON e.id = ne.entity_id WHERE ne.node_id IN (${placeholders})`,
      )
      .all(...nodeIDs) as Row[]
    const map = new Map<string, EntityRecord[]>()
    for (const row of rows) {
      const list = map.get(row.node_id as string) ?? []
      list.push({
        id: row.id as string,
        name: row.name as string,
        kind: row.kind as string,
        aliases: JSON.parse(row.aliases_json as string) as string[],
      })
      map.set(row.node_id as string, list)
    }
    return map
  }

  listEntities(input: { kind?: string; query?: string; limit?: number } = {}) {
    const rows = this.db.prepare("SELECT * FROM entities ORDER BY updated_at DESC").all() as Row[]
    const q = input.query?.toLowerCase()
    return rows
      .filter((row) => !input.kind || row.kind === input.kind)
      .filter((row) => !q || (row.name as string).toLowerCase().includes(q) || (row.aliases_json as string).toLowerCase().includes(q))
      .slice(0, input.limit ?? 50)
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        kind: row.kind as string,
        aliases: JSON.parse(row.aliases_json as string) as string[],
      }))
  }

  addFacts(input: {
    entity: string
    facts: Array<{ content: string; replaces?: string }>
    sourceNodeID?: string
    now?: number
  }): FactRecord[] {
    const now = input.now ?? Date.now()
    const entity = this.resolveEntity({ name: input.entity }, now)
    return input.facts.map((fact) => {
      if (fact.replaces) {
        this.db
          .prepare("UPDATE facts SET invalid_at = ?, replaced_by = ?, updated_at = ? WHERE id = ?")
          .run(now, "pending", now, fact.replaces)
      }
      const id = `fact_${randomUUID()}`
      this.db
        .prepare(
          "INSERT INTO facts (id, entity_id, content, valid_at, invalid_at, replaced_by, source_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
        )
        .run(id, entity.id, sanitizeMemory(fact.content), now, input.sourceNodeID ?? null, now, now)
      if (fact.replaces) {
        this.db.prepare("UPDATE facts SET replaced_by = ? WHERE id = ?").run(id, fact.replaces)
      }
      this.log("fact", id, { entity: entity.name })
      return {
        id,
        entityId: entity.id,
        content: fact.content,
        validAt: now,
        sourceNodeID: input.sourceNodeID,
      }
    })
  }

  factsOfEntity(input: { entity?: string; entityId?: string; includeInvalid?: boolean; asOf?: number; limit?: number; offset?: number }) {
    let entityID = input.entityId
    if (!entityID && input.entity) {
      const rows = this.db.prepare("SELECT * FROM entities").all() as Row[]
      const match = rows.find((row) => {
        if (row.name === input.entity) return true
        return (JSON.parse(row.aliases_json as string) as string[]).includes(input.entity!)
      })
      entityID = match?.id as string | undefined
    }
    if (!entityID) return { items: [], ambiguous: false }
    const rows = this.db
      .prepare(
        `SELECT * FROM facts WHERE entity_id = ?
         ${input.includeInvalid ? "" : "AND invalid_at IS NULL"}
         ${input.asOf ? "AND valid_at <= ? AND (invalid_at IS NULL OR invalid_at > ?)" : ""}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...([
          entityID,
          ...(input.asOf ? [input.asOf, input.asOf] : []),
          Math.min(input.limit ?? 20, 100),
          input.offset ?? 0,
        ] as unknown[]),
      ) as Row[]
    return {
      items: rows.map((row) => ({
        id: row.id as string,
        entityId: row.entity_id as string,
        content: row.content as string,
        validAt: Number(row.valid_at),
        invalidAt: row.invalid_at === null ? undefined : Number(row.invalid_at),
        replacedBy: (row.replaced_by as string | null) ?? undefined,
        sourceNodeID: (row.source_node_id as string | null) ?? undefined,
      })),
      ambiguous: false,
    }
  }

  addObservation(input: { scope: MemoryScope; belief: string; sources: string[]; status?: ObservationRecord["status"]; now?: number }) {
    const now = input.now ?? Date.now()
    const id = `obs_${randomUUID()}`
    this.db
      .prepare("INSERT INTO observations (id, scope, belief, status, sources_json, proof_count, embedding, created_at, updated_at, last_validated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)")
      .run(id, input.scope, sanitizeMemory(input.belief), input.status ?? "active", JSON.stringify(input.sources), input.sources.length, now, now, now)
    this.log("reflect", id, { proof: input.sources.length })
    return id
  }

  observations(limit = 50) {
    return (this.db.prepare("SELECT * FROM observations WHERE status = 'active' ORDER BY proof_count DESC, updated_at DESC LIMIT ?").all(limit) as Row[]).map(
      (row) => ({
        id: row.id as string,
        scope: row.scope as MemoryScope,
        belief: row.belief as string,
        status: row.status as ObservationRecord["status"],
        sources: JSON.parse(row.sources_json as string) as string[],
        proofCount: Number(row.proof_count),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        lastValidatedAt: Number(row.last_validated_at),
      }),
    )
  }

  sessionSummary(sessionID: string, summary?: string, now = Date.now()) {
    if (summary !== undefined) {
      this.db
        .prepare("INSERT INTO session_summaries (session_id, summary, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at")
        .run(sessionID, sanitizeMemory(summary), now)
      return
    }
    const row = this.db.prepare("SELECT summary FROM session_summaries WHERE session_id = ?").get(sessionID) as { summary: string } | undefined
    return row?.summary
  }

  audit(limit = 100, targetID?: string) {
    const rows = targetID
      ? (this.db.prepare("SELECT * FROM op_log WHERE target_id = ? ORDER BY seq DESC LIMIT ?").all(targetID, limit) as Row[])
      : (this.db.prepare("SELECT * FROM op_log ORDER BY seq DESC LIMIT ?").all(limit) as Row[])
    return rows.map((row) => ({
      seq: Number(row.seq),
      at: Number(row.at),
      op: row.op as string,
      targetID: row.target_id as string,
      detail: row.detail ? JSON.parse(row.detail as string) : undefined,
    }))
  }

  embeddingMeta() {
    const row = this.db.prepare("SELECT * FROM embedding_meta WHERE scope = ?").get(this.scope) as Row | undefined
    return row ? { model: row.model as string, dimensions: Number(row.dimensions) } : undefined
  }

  setEmbeddingMeta(model: string, dimensions: number) {
    const current = this.embeddingMeta()
    if (current && current.dimensions !== dimensions) throw new Error(`embedding dimension mismatch: ${current.dimensions} != ${dimensions}`)
    this.db
      .prepare("INSERT INTO embedding_meta (scope, model, dimensions, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET model = excluded.model, dimensions = excluded.dimensions, updated_at = excluded.updated_at")
      .run(this.scope, model, dimensions, Date.now())
  }

  ingestCursor(sessionID: string) {
    const row = this.db.prepare("SELECT slice_key FROM ingest_cursor WHERE session_id = ?").get(sessionID) as { slice_key: string } | undefined
    return row?.slice_key
  }

  setIngestCursor(sessionID: string, sliceKey: string, now = Date.now()) {
    this.db
      .prepare("INSERT INTO ingest_cursor (session_id, slice_key, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET slice_key = excluded.slice_key, updated_at = excluded.updated_at")
      .run(sessionID, sliceKey, now)
  }
  pending(input: { sessionID: string; sliceKey: string; reason: string; messages: unknown; now?: number }) {
    const now = input.now ?? Date.now()
    this.db
      .prepare("INSERT INTO ingest_pending (session_id, slice_key, reason, messages_json, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(session_id, slice_key) DO UPDATE SET reason = excluded.reason, messages_json = excluded.messages_json, updated_at = excluded.updated_at")
      .run(input.sessionID, input.sliceKey, input.reason, JSON.stringify(input.messages), now, now)
  }

  pendingList(sessionID: string) {
    return (this.db.prepare("SELECT * FROM ingest_pending WHERE session_id = ? ORDER BY created_at").all(sessionID) as Row[]).map((row) => ({
      sessionID: row.session_id as string,
      sliceKey: row.slice_key as string,
      reason: row.reason as string,
      messages: JSON.parse(row.messages_json as string),
      attempts: Number(row.attempts),
    }))
  }

  pendingDelete(sessionID: string, sliceKey: string) {
    this.db.prepare("DELETE FROM ingest_pending WHERE session_id = ? AND slice_key = ?").run(sessionID, sliceKey)
  }

  pendingFail(sessionID: string, sliceKey: string) {
    this.db
      .prepare("UPDATE ingest_pending SET attempts = attempts + 1, updated_at = ? WHERE session_id = ? AND slice_key = ?")
      .run(Date.now(), sessionID, sliceKey)
  }

  clear() {
    this.transaction(() => {
      for (const table of [
        "nodes_fts",
        "node_entities",
        "edges",
        "nodes_revisions",
        "tour_routes",
        "facts",
        "observations",
        "session_summaries",
        "ingest_pending",
        "nodes",
        "embedding_meta",
      ]) {
        this.db.prepare(`DELETE FROM ${table}`).run()
      }
    })
  }

  private merge(row: Row, now: number, similarity?: number): SaveResult {
    this.db
      .prepare("UPDATE nodes SET confidence = MIN(1, confidence + 0.05), access_count = access_count + 1, last_accessed_at = ? WHERE id = ?")
      .run(now, row.id)
    this.log("merge", row.id as string, similarity === undefined ? undefined : { similarity })
    return { disposition: "merge", node: this.getNode(row.id as string), mergedInto: row.id as string, similarity }
  }

  private similar(content: string, embedding: Float32Array) {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE status = 'active' AND embedding IS NOT NULL").all() as Row[]
    let best: { row: Row; similarity: number } | undefined
    for (const row of rows) {
      const other = this.bytesToVector(row.embedding as Uint8Array)
      if (!other || other.length !== embedding.length) continue
      const similarity = cosine(embedding, other)
      if (!best || similarity > best.similarity) best = { row, similarity }
    }
    return best
  }

  private insertNode(input: {
    id: string
    scope: MemoryScope
    kind: MemoryKind
    content: string
    contentHash: string
    importance: number
    confidence: number
    status: MemoryStatus
    createdAt: number
    lastAccessedAt: number
    accessCount: number
    sourceSessionID?: string
    sourceRound?: number
    sourceSeq?: number
    embedding?: Float32Array
    imagery?: Imagery
    slot?: Slot
    schedule?: ReviewSchedule
  }) {
    this.db
      .prepare(
        `INSERT INTO nodes (id, scope, kind, content, content_hash, importance, confidence, status, created_at, last_accessed_at, access_count, source_session_id, source_round, source_seq, embedding, imagery_json, slot_room, slot_index, imagery_score, next_review_at, ease_factor, interval_days, review_reps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.scope,
        input.kind,
        input.content,
        input.contentHash,
        input.importance,
        input.confidence,
        input.status,
        input.createdAt,
        input.lastAccessedAt,
        input.accessCount,
        input.sourceSessionID ?? null,
        input.sourceRound ?? null,
        input.sourceSeq ?? null,
        input.embedding ? Buffer.from(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength) : null,
        input.imagery ? JSON.stringify(input.imagery) : null,
        input.slot?.room ?? null,
        input.slot?.index ?? null,
        input.imagery?.score ?? null,
        input.schedule?.nextReviewAt ?? null,
        input.schedule?.easeFactor ?? null,
        input.schedule?.intervalDays ?? null,
        input.schedule?.reps ?? 0,
      )
    this.db.prepare("INSERT INTO nodes_fts (node_id, search_text) VALUES (?, ?)").run(input.id, searchText(input.content))
  }

  private imagery(content: string, placard: string | undefined, now: number, slot?: Slot): Imagery | undefined {
    if (!placard) return
    const all = (this.db.prepare("SELECT content FROM nodes WHERE status = 'active'").all() as Array<{ content: string }>).map(
      (row) => row.content,
    )
    const room = slot
      ? (this.db.prepare("SELECT content FROM nodes WHERE status = 'active' AND slot_room = ?").all(slot.room) as Array<{
          content: string
        }>).map((row) => row.content)
      : []
    return { caption: placard, score: scorePlacard({ content: placard, createdAt: now, allContents: all, roomContents: room }) }
  }

  private imageryScore(content: string, placard: string, room: string | null) {
    const roomRows = room
      ? (this.db.prepare("SELECT content FROM nodes WHERE status = 'active' AND slot_room = ?").all(room) as Array<{ content: string }>)
      : []
    const allRows = this.db.prepare("SELECT content FROM nodes WHERE status = 'active'").all() as Array<{ content: string }>
    return scorePlacard({
      content: placard,
      createdAt: Date.now(),
      allContents: allRows.map((row) => row.content),
      roomContents: roomRows.map((row) => row.content),
    })
  }

  private occupancy() {
    const rows = this.db
      .prepare("SELECT slot_room AS room, COUNT(*) AS count, MAX(slot_index) AS maxIndex FROM nodes WHERE status = 'active' AND slot_room IS NOT NULL GROUP BY slot_room")
      .all() as Array<{ room: string; count: number; maxIndex: number }>
    return Object.fromEntries(rows.map((row) => [row.room, { count: Number(row.count), maxIndex: Number(row.maxIndex) }]))
  }

  private appendRoute(nodeID: string) {
    this.db
      .prepare("INSERT INTO tour_routes (position, node_id) VALUES ((SELECT COALESCE(MAX(position), -1) + 1 FROM tour_routes), ?)")
      .run(nodeID)
  }

  private log(op: string, targetID: string, detail?: Record<string, unknown>) {
    this.db
      .prepare("INSERT INTO op_log (at, op, target_id, detail) VALUES (?, ?, ?, ?)")
      .run(Date.now(), op, targetID, detail ? JSON.stringify(detail) : null)
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = fn()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  private rowNode(row: Row): MemoryNode {
    return {
      id: row.id as string,
      scope: row.scope as MemoryScope,
      kind: row.kind as MemoryKind,
      content: row.content as string,
      importance: Number(row.importance),
      confidence: Number(row.confidence),
      status: row.status as MemoryStatus,
      createdAt: Number(row.created_at),
      lastAccessedAt: Number(row.last_accessed_at),
      accessCount: Number(row.access_count),
      sourceSessionID: (row.source_session_id as string | null) ?? undefined,
      sourceRound: row.source_round === null ? undefined : Number(row.source_round),
      sourceSeq: row.source_seq === null ? undefined : Number(row.source_seq),
      outcome: (row.outcome as string | null) ?? undefined,
      imagery: row.imagery_json ? (JSON.parse(row.imagery_json as string) as Imagery) : undefined,
      slot:
        row.slot_room === null
          ? undefined
          : { room: row.slot_room as string, index: Number(row.slot_index) },
      review: {
        nextReviewAt: row.next_review_at === null ? null : Number(row.next_review_at),
        easeFactor: row.ease_factor === null ? 2.5 : Number(row.ease_factor),
        intervalDays: row.interval_days === null ? 0 : Number(row.interval_days),
        reps: Number(row.review_reps ?? 0),
      },
    }
  }

  private bytesToVector(bytes: Uint8Array | null) {
    if (!bytes) return
    const copy = new Uint8Array(bytes)
    if (copy.byteLength % 4 !== 0) return
    return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
  }
}

export function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0
  let left = 0
  let right = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    left += a[i]! * a[i]!
    right += b[i]! * b[i]!
  }
  if (!left || !right) return 0
  return dot / Math.sqrt(left * right)
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
