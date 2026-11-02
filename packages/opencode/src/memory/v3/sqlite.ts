export interface SqlStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

type BunDatabase = {
  new (filename: string): {
    exec(sql: string): void
    prepare(sql: string): {
      run(...params: unknown[]): unknown
      get(...params: unknown[]): unknown
      all(...params: unknown[]): unknown[]
    }
    close(): void
  }
}

type NodeDatabase = {
  new (filename: string): {
    exec(sql: string): void
    prepare(sql: string): {
      run(...params: unknown[]): unknown
      get(...params: unknown[]): unknown
      all(...params: unknown[]): unknown[]
    }
    close(): void
  }
}

const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>

export async function openSqlite(filename: string): Promise<SqlDatabase> {
  if (typeof (process.versions as { bun?: string }).bun === "string") {
    const mod = (await load("bun:sqlite")) as { Database: BunDatabase }
    const db = new mod.Database(filename)
    configure(db)
    return db
  }
  const mod = (await load("node:sqlite")) as { DatabaseSync: NodeDatabase }
  const db = new mod.DatabaseSync(filename)
  configure(db)
  return db
}

function configure(db: SqlDatabase) {
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")
}
