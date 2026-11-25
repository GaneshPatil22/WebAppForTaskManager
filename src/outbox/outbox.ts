import { ulid } from 'ulid';
import { isApiError, type BrainClient } from '../api/client';
import type { Capture, CaptureSource } from '../api/types';
import type { OutboxEntry, OutboxStore, QueuedEntry } from './store';

/**
 * Outboxes: what the user wrote is written to the device first, then sent.
 * An entry leaves the store only when the server answers 200 or 201, or
 * when the user explicitly discards one the server refused as invalid.
 * Every entry carries its own ULID, and the server is idempotent on it, so
 * a retry can never make a second copy.
 *
 * Backoff follows Brain's harness: base 500 ms, doubling, ±25% jitter, 30 s cap.
 */
export interface OutboxOptions {
  now?: () => number;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export type OutboxListener = (entries: OutboxEntry[]) => void;

export const MAX_CAPTURE_CHARS = 20000;

/**
 * The sending half shared by every outbox: store first, send in order, keep
 * what failed with backoff, pause while signed out. Subclasses say how one
 * entry is sent and what the server gives back for it.
 */
export abstract class Outbox<E extends QueuedEntry, R> {
  protected entries: E[] = [];
  private listeners = new Set<(entries: E[]) => void>();
  private storedListeners = new Set<(r: R) => void>();
  private flushing: Promise<void> | null = null;
  private again = false;
  private paused = false;
  private timer: unknown = null;
  protected ready: Promise<void>;
  protected readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (h: unknown) => void;

  constructor(protected readonly store: OutboxStore<E>, protected readonly client: BrainClient, o: OutboxOptions = {}) {
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    this.schedule = o.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = o.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.ready = store.all().then((rows) => { this.entries = rows; this.emit(); });
  }

  /** Stores an entry and starts sending it. Resolves once it is safe on this device. */
  protected async add(entry: E): Promise<E> {
    await this.ready;
    await this.store.put(entry);
    this.entries.push(entry);
    this.emit();
    void this.flush();
    return entry;
  }

  /** Sends one entry. Must be idempotent on the entry's id. */
  protected abstract send(e: E): Promise<R>;

  /** A refusal no retry can fix: kept as `rejected` for the user to see. */
  protected refused(err: unknown): boolean {
    return isApiError(err) && err.kind === 'invalid';
  }

  snapshot(): E[] { return this.entries.map((e) => ({ ...e })); }

  subscribe(l: (entries: E[]) => void): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  /** Called with what the server returned, once it holds an entry. */
  onStored(l: (r: R) => void): () => void {
    this.storedListeners.add(l);
    return () => this.storedListeners.delete(l);
  }

  /** Stop sending, e.g. while signed out. Nothing is dropped. */
  pause() { this.paused = true; this.clearTimer(); }
  resume() { this.paused = false; void this.flush(true); }

  /** The user chose to throw away an entry the server refused. */
  async discard(id: string) {
    await this.store.delete(id);
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  /** Try everything now, ignoring backoff (e.g. the network came back). */
  retryNow() { void this.flush(true); }

  flush(force = false): Promise<void> {
    if (this.flushing) { this.again = true; return this.flushing; }
    this.flushing = this.run(force).finally(() => {
      this.flushing = null;
      if (this.again) { this.again = false; void this.flush(); }
    });
    return this.flushing;
  }

  private async run(force: boolean) {
    await this.ready;
    if (this.paused) return;
    this.clearTimer();
    for (const e of [...this.entries]) {
      if (this.paused) return;
      if (e.state !== 'pending' || (!force && e.nextAttemptAt > this.now())) continue;
      try {
        const result = await this.send(e);
        await this.store.delete(e.id);
        this.entries = this.entries.filter((x) => x.id !== e.id);
        this.emit();
        for (const l of this.storedListeners) l(result);
      } catch (err) {
        const updated: E = { ...e, attempts: e.attempts + 1 };
        if (this.refused(err)) {
          updated.state = 'rejected';
          updated.lastError = isApiError(err) ? err.message : String(err);
        } else if (isApiError(err) && err.kind === 'unauthorized') {
          updated.lastError = 'Signed out. Sending resumes after you sign in.';
          this.paused = true;
        } else {
          updated.lastError = isApiError(err) ? err.message : String(err);
          updated.nextAttemptAt = this.now() + this.backoff(updated.attempts);
        }
        await this.store.put(updated);
        this.entries = this.entries.map((x) => (x.id === e.id ? updated : x));
        this.emit();
        if (this.paused) return;
      }
    }
    this.scheduleNext();
  }

  backoff(attempt: number): number {
    const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
    const jitter = 1 + (this.random() * 0.5 - 0.25);
    return Math.min(30_000, Math.round(base * jitter));
  }

  private scheduleNext() {
    const pending = this.entries.filter((e) => e.state === 'pending');
    if (!pending.length || this.paused) return;
    const at = Math.min(...pending.map((e) => e.nextAttemptAt));
    this.timer = this.schedule(() => { this.timer = null; void this.flush(); }, Math.max(0, at - this.now()));
  }

  private clearTimer() {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
  }

  private emit() {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }
}

/**
 * Captures. A capture is never lost (Brain invariant 2), and that starts
 * here, before the server has seen it.
 */
export class CaptureOutbox extends Outbox<OutboxEntry, Capture> {
  /** Stores the capture locally and starts sending it. Resolves once it is safe on this device. */
  async enqueue(text: string, source: CaptureSource = 'text'): Promise<OutboxEntry> {
    const t = this.now();
    const entry: OutboxEntry = {
      id: ulid(t), text, source, capturedAt: new Date(t).toISOString(),
      attempts: 0, nextAttemptAt: t, state: 'pending',
    };
    return this.add(entry);
  }

  protected async send(e: OutboxEntry): Promise<Capture> {
    const { capture } = await this.client.createCapture({ id: e.id, text: e.text, source: e.source, capturedAt: e.capturedAt });
    return capture;
  }
}
