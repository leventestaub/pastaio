/**
 * SQLite-backed storage adapter for zustand's persist middleware.
 *
 * Why a custom adapter instead of AsyncStorage:
 * - Already have expo-sqlite for the KB; not adding another dep.
 * - SQLite plays nicely with the eventual export flow (one file the
 *   user can copy / inspect via Files app).
 *
 * Why a separate db from pastaio-kb.db:
 * - The KB is bundled and read-only; it rebuilds on every app update.
 * - Memory is writable and must survive app updates. Mixing them risks
 *   wiping user data when the bundled KB is updated.
 *
 * The schema is the simplest possible: one table, key/value text, that's
 * it. We're not querying user data with SQL; persist serializes the whole
 * store to a JSON blob per key. Could add real columns later if needed,
 * but for tens-of-KB-per-store data this is fine and costs nothing.
 */
import * as SQLite from 'expo-sqlite';
import type { StateStorage } from 'zustand/middleware';
import { Platform } from 'react-native';

const DB_NAME = 'pastaio-memory.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    return db;
  })();
  return dbPromise;
}

/** zustand StateStorage implementation. */
// Web (README capture): expo-sqlite web worker races with the KB open; use localStorage.
const webStorage: StateStorage = {
  getItem: (k) => globalThis.localStorage?.getItem(k) ?? null,
  setItem: (k, v) => void globalThis.localStorage?.setItem(k, v),
  removeItem: (k) => void globalThis.localStorage?.removeItem(k),
};

const nativeStorage: StateStorage = {
  getItem: async (key) => {
    try {
      const db = await getDb();
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM kv WHERE key = ?',
        [key],
      );
      return row?.value ?? null;
    } catch (err) {
      console.warn('[sqliteStorage] getItem failed:', String(err));
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      const db = await getDb();
      await db.runAsync(
        'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
        [key, value],
      );
    } catch (err) {
      console.warn('[sqliteStorage] setItem failed:', String(err));
    }
  },
  removeItem: async (key) => {
    try {
      const db = await getDb();
      await db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
    } catch (err) {
      console.warn('[sqliteStorage] removeItem failed:', String(err));
    }
  },
};

export const sqliteStorage: StateStorage = Platform.OS === 'web' ? webStorage : nativeStorage;
/**
 * Wipe ALL persisted data. Used by resetAll in the memory store and by
 * any future "clear data" UI affordance.
 *
 * This deletes rows, not the table — the table can be reused immediately
 * on next write.
 */
export async function clearAllPersistedData(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync('DELETE FROM kv');
  } catch (err) {
    console.warn('[sqliteStorage] clearAllPersistedData failed:', String(err));
  }
}
