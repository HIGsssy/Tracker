import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config/env';
import * as schema from './schema';

const sqlite = new Database(config.DATABASE_PATH);

// WAL mode: allows concurrent readers without blocking writes
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
