// One small query interface over two Postgres backends:
//  - DATABASE_URL set  -> node-postgres (Neon / Vercel Postgres in production)
//  - otherwise         -> PGlite, an embedded Postgres (local dev: data/dev-db, tests: in memory)
import path from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    parent_department TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    designation TEXT NOT NULL DEFAULT '',
    functional_title TEXT NOT NULL DEFAULT '',
    band TEXT NOT NULL DEFAULT '',
    manager_id TEXT,
    manager_name TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    employee_id TEXT
  );
  CREATE TABLE IF NOT EXISTS assessments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role_id TEXT NOT NULL,
    current_level TEXT NOT NULL,
    target_level TEXT NOT NULL,
    quick INTEGER NOT NULL DEFAULT 0,
    is_test INTEGER NOT NULL DEFAULT 0,
    subject_employee_id TEXT,
    subject_name TEXT,
    manager_employee_id TEXT,
    manager_name TEXT,
    self_submitted_at TIMESTAMPTZ,
    manager_submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS assessments_manager_idx ON assessments (manager_employee_id);
  CREATE TABLE IF NOT EXISTS responses (
    assessment_id INTEGER NOT NULL REFERENCES assessments(id),
    reviewer TEXT NOT NULL CHECK (reviewer IN ('self','manager')),
    skill_id TEXT NOT NULL,
    rating INTEGER,
    skipped INTEGER NOT NULL DEFAULT 0,
    evidence TEXT NOT NULL DEFAULT '',
    scenario TEXT,
    PRIMARY KEY (assessment_id, reviewer, skill_id)
  );
`;

export async function openDb({ url = process.env.DATABASE_URL, memory = false, file = 'data/dev-db' } = {}) {
  if (!url && !memory && process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is not set. In Vercel: Storage -> create a Neon database and connect it to this project.');
  let run, exec;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 3 });
    run = (sql, params) => pool.query(sql, params);
    exec = (sql) => pool.query(sql);
  } else {
    // Local/test only. Imported by variable name so the Vercel bundler doesn't ship this large WASM package.
    const pkg = '@electric-sql/pglite';
    const { PGlite } = await import(pkg);
    const lite = new PGlite(memory ? undefined : path.resolve(file));
    run = (sql, params) => lite.query(sql, params);
    exec = (sql) => lite.exec(sql);
  }
  await exec(SCHEMA);
  return {
    query: async (sql, params = []) => (await run(sql, params)).rows,
    one: async (sql, params = []) => (await run(sql, params)).rows[0] ?? null,
    run: async (sql, params = []) => { await run(sql, params); },
  };
}
