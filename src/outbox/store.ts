import { openDB, type IDBPDatabase } from 'idb';
import type { CaptureSource } from '../api/types';

/** A capture waiting to be sent. Its ULID is generated here and is the idempotency key. */
export interface OutboxEntry extends QueuedEntry {
  text: string;
  source: CaptureSource;
  capturedAt: string;
}

/** What every outbox entry carries, whatever it sends. The id is the idempotency key. */
export interface QueuedEntry {
  id: string;
  attempts: number;
  nextAttemptAt: number;
  /** `rejected`: the server refused it as invalid. Kept until the user decides. */
  state: 'pending' | 'rejected';
  lastError?: string;
}

export interface OutboxStore<E extends QueuedEntry = OutboxEntry> {
  all(): Promise<E[]>;
  put(e: E): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MemoryOutboxStore<E extends QueuedEntry = OutboxEntry> implements OutboxStore<E> {
  private rows = new Map<string, E>();
  async all() { return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id)); }
  async put(e: E) { this.rows.set(e.id, { ...e }); }
  async delete(id: string) { this.rows.delete(id); }
}

/**
 * IndexedDB survives reloads, closed tabs and a dead network. One database
 * per outbox, so adding one never needs a migration of another.
 */
export class IdbOutboxStore<E extends QueuedEntry = OutboxEntry> implements OutboxStore<E> {
  private db: Promise<IDBPDatabase>;
  constructor(name = 'brain-outbox', private readonly table = 'captures') {
    this.db = openDB(name, 1, {
      upgrade(db) { db.createObjectStore(table, { keyPath: 'id' }); },
    });
  }
  async all() { return ((await (await this.db).getAll(this.table)) as E[]).sort((a, b) => a.id.localeCompare(b.id)); }
  async put(e: E) { await (await this.db).put(this.table, e); }
  async delete(id: string) { await (await this.db).delete(this.table, id); }
}
