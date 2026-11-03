export const SCHEMA_VERSION = 2

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  importance REAL NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  source_session_id TEXT,
  source_round INTEGER,
  source_seq INTEGER,
  embedding BLOB,
  outcome TEXT,
  imagery_json TEXT,
  slot_room TEXT,
  slot_index INTEGER,
  imagery_score REAL,
  next_review_at INTEGER,
  ease_factor REAL,
  interval_days REAL,
  review_reps INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edges (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, type)
);
CREATE TABLE IF NOT EXISTS op_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  op TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS nodes_revisions (
  node_id TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL,
  importance REAL NOT NULL,
  superseded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tour_routes (
  position INTEGER PRIMARY KEY,
  node_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_blocks (
  scope TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_block_versions (
  scope TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (scope, version)
);
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS node_entities (
  node_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (node_id, entity_id)
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  valid_at INTEGER NOT NULL,
  invalid_at INTEGER,
  replaced_by TEXT,
  source_node_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  belief TEXT NOT NULL,
  status TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  proof_count INTEGER NOT NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_validated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_cursor (
  session_id TEXT PRIMARY KEY,
  slice_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_pending (
  session_id TEXT NOT NULL,
  slice_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, slice_key)
);
CREATE TABLE IF NOT EXISTS embedding_meta (
  scope TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reflect_suggestions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  target_id TEXT,
  content TEXT,
  reason TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reflect_suggestions_status ON reflect_suggestions (status, created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(node_id UNINDEXED, search_text, tokenize='unicode61');
CREATE INDEX IF NOT EXISTS nodes_scope_status ON nodes (scope, status);
CREATE INDEX IF NOT EXISTS nodes_kind_created ON nodes (kind, created_at);
CREATE INDEX IF NOT EXISTS nodes_session_created ON nodes (source_session_id, created_at);
CREATE INDEX IF NOT EXISTS nodes_slot ON nodes (slot_room, slot_index);
CREATE INDEX IF NOT EXISTS nodes_review_due ON nodes (next_review_at);
CREATE INDEX IF NOT EXISTS nodes_content_hash ON nodes (content_hash);
CREATE INDEX IF NOT EXISTS entities_name ON entities (name);
CREATE INDEX IF NOT EXISTS node_entities_entity ON node_entities (entity_id);
CREATE INDEX IF NOT EXISTS facts_entity ON facts (entity_id);
CREATE INDEX IF NOT EXISTS observations_status ON observations (status, proof_count, updated_at);
CREATE INDEX IF NOT EXISTS op_log_target ON op_log (target_id);
CREATE INDEX IF NOT EXISTS op_log_at ON op_log (at);
`

const REFLECT_SQL = `
CREATE TABLE IF NOT EXISTS reflect_suggestions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  target_id TEXT,
  content TEXT,
  reason TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reflect_suggestions_status ON reflect_suggestions (status, created_at);
`

export function migrate(db: { exec: (sql: string) => void; prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown } }) {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (row) {
    const version = Number(row.value)
    if (!Number.isInteger(version) || version > SCHEMA_VERSION) throw new Error(`memory schema ${row.value} is newer than supported ${SCHEMA_VERSION}`)
    if (version === 1) {
      db.exec(REFLECT_SQL)
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION))
      return
    }
    if (version < SCHEMA_VERSION) throw new Error(`memory schema migration missing from ${version} to ${SCHEMA_VERSION}`)
    return
  }
  db.exec(SCHEMA_SQL)
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
}
