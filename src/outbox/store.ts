import { openDB, type IDBPDatabase } from 'idb';
import type { CaptureSource } from '../api/types';

export interface OutboxEntry {
  /** The capture's ULID, generated here. It is also the idempotency key. */
  id: string;
  text: string;
  source: CaptureSource;
  capturedAt: string;
  attempts: number;
  nextAttemptAt: number;
  /** `rejected`: the server refused it as invalid. Kept until the user decides. */
  state: 'pending' | 'rejected';
  lastError?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(e: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private rows = new Map<string, OutboxEntry>();
  async all() { return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id)); }
  async put(e: OutboxEntry) { this.rows.set(e.id, { ...e }); }
  async delete(id: string) { this.rows.delete(id); }
}

/** IndexedDB survives reloads, closed tabs and a dead network. */
export class IdbOutboxStore implements OutboxStore {
  private db: Promise<IDBPDatabase>;
  constructor(name = 'brain-outbox') {
    this.db = openDB(name, 1, {
      upgrade(db) { db.createObjectStore('captures', { keyPath: 'id' }); },
    });
  }
  async all() { return ((await (await this.db).getAll('captures')) as OutboxEntry[]).sort((a, b) => a.id.localeCompare(b.id)); }
  async put(e: OutboxEntry) { await (await this.db).put('captures', e); }
  async delete(id: string) { await (await this.db).delete('captures', id); }
}
