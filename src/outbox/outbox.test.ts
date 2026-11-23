import { describe, expect, it, vi } from 'vitest';
import { CaptureOutbox } from './outbox';
import { MemoryOutboxStore, IdbOutboxStore } from './store';
import { ApiError, type BrainClient } from '../api/client';

function fakeClient(script: Array<'ok' | 'dup' | 503 | 400 | 401 | 'network'>) {
  const seen: string[] = [];
  const createCapture = vi.fn(async (input: { id: string; text: string }) => {
    seen.push(input.id);
    const step = script.shift() ?? 'ok';
    if (step === 'network') throw new ApiError(0, 'network', 'offline');
    if (typeof step === 'number') throw new ApiError(step, step === 400 ? 'invalid_text' : 'x', 'nope');
    return { capture: { id: input.id, text: input.text, source: 'text' as const, status: 'raw' as const, capturedAt: '' }, created: step === 'ok' };
  });
  return { client: { createCapture } as unknown as BrainClient, seen, createCapture };
}

const manual = () => {
  let now = 1_000_000;
  const o = { now: () => now, random: () => 0.5, schedule: () => 1, cancel: () => {} };
  return { o, advance: (ms: number) => { now += ms; } };
};

describe('CaptureOutbox — a capture is never lost', () => {
  it('stores first, then sends, then forgets only after the server has it', async () => {
    const store = new MemoryOutboxStore();
    const { client, createCapture } = fakeClient(['ok']);
    const { o } = manual();
    const box = new CaptureOutbox(store, client, o);
    const stored = vi.fn();
    box.onStored(stored);
    await box.enqueue('buy milk');
    await box.flush();
    expect(createCapture).toHaveBeenCalledOnce();
    expect(stored).toHaveBeenCalledOnce();
    expect(await store.all()).toEqual([]);
  });

  it('keeps retrying through outages with the same id, with growing backoff', async () => {
    const store = new MemoryOutboxStore();
    const { client, seen } = fakeClient(['network', 503, 'ok']);
    const { o, advance } = manual();
    const box = new CaptureOutbox(store, client, o);
    const e = await box.enqueue('kal plumber ko call karna hai');
    await box.flush();
    let [row] = await store.all();
    expect(row).toMatchObject({ attempts: 1, state: 'pending' });
    const firstWait = row!.nextAttemptAt - 1_000_000;
    advance(firstWait);
    await box.flush();
    [row] = await store.all();
    expect(row!.attempts).toBe(2);
    expect(row!.nextAttemptAt - (1_000_000 + firstWait)).toBeGreaterThan(firstWait);
    advance(60_000);
    await box.flush();
    expect(await store.all()).toEqual([]);
    expect(new Set(seen)).toEqual(new Set([e.id]));
  });

  it('a duplicate answer (200) also counts as stored', async () => {
    const store = new MemoryOutboxStore();
    const { client } = fakeClient(['dup']);
    const box = new CaptureOutbox(store, client, manual().o);
    await box.enqueue('x');
    await box.flush();
    expect(await store.all()).toEqual([]);
  });

  it('a refused capture is kept, marked rejected, until the user discards it', async () => {
    const store = new MemoryOutboxStore();
    const { client } = fakeClient([400]);
    const box = new CaptureOutbox(store, client, manual().o);
    const e = await box.enqueue('x');
    await box.flush();
    expect(await store.all()).toMatchObject([{ id: e.id, state: 'rejected' }]);
    await box.discard(e.id);
    expect(await store.all()).toEqual([]);
  });

  it('401 pauses sending without dropping anything', async () => {
    const store = new MemoryOutboxStore();
    const { client, createCapture } = fakeClient([401, 'ok', 'ok']);
    const box = new CaptureOutbox(store, client, manual().o);
    await box.enqueue('one');
    await box.enqueue('two');
    await box.flush();
    expect(createCapture).toHaveBeenCalledTimes(1);
    expect((await store.all()).length).toBe(2);
    box.resume();
    await box.flush();
    expect(await store.all()).toEqual([]);
  });

  it('survives a reload: a new outbox over the same IndexedDB sends what was left', async () => {
    const name = `test-${Math.random()}`;
    const down = fakeClient(['network']);
    const box1 = new CaptureOutbox(new IdbOutboxStore(name), down.client, manual().o);
    const e = await box1.enqueue('written offline');
    await box1.flush();
    const up = fakeClient(['ok']);
    const box2 = new CaptureOutbox(new IdbOutboxStore(name), up.client, manual().o);
    await box2.flush(true);
    expect(up.seen).toEqual([e.id]);
    expect(box2.snapshot()).toEqual([]);
  });

  it('backoff is capped at 30 s', () => {
    const box = new CaptureOutbox(new MemoryOutboxStore(), fakeClient([]).client, { random: () => 1 });
    expect(box.backoff(1)).toBe(625);
    expect(box.backoff(20)).toBe(30_000);
  });
});
