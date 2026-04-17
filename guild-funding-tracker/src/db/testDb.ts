// Creates an isolated in-memory drizzle DB with the full schema applied.
// Import this only from test files — never from production code.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as schema from './schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');

  const migrationSql = readFileSync(
    join(__dirname, 'migrations', '0000_initial.sql'),
    'utf-8',
  );

  // Each statement is separated by "--> statement-breakpoint" in drizzle migration files.
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    sqlite.exec(stmt);
  }

  return drizzle(sqlite, { schema });
}
