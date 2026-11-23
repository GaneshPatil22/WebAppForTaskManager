import { afterEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { MockBrainClient } from './mockClient';
import { ApiError } from '../client';

const make = () => new MockBrainClient({ storageKey: null, latencyMs: [0, 0], enrichDelayMs: [0, 0] });
const settle = () => new Promise((r) => setTimeout(r, 5));
let clients: MockBrainClient[] = [];
afterEach(() => { clients.forEach((c) => c.dispose()); clients = []; });
const client = () => { const c = make(); clients.push(c); return c; };

describe('MockBrainClient follows the contract', () => {
  it('create is idempotent by id: 201 then 200, text never edited', async () => {
    const c = client();
    const id = ulid();
    const first = await c.createCapture({ id, text: 'buy milk' });
    const again = await c.createCapture({ id, text: 'something else' });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.capture.text).toBe('buy milk');
  });

  it('enriches a capture into an item, in the background', async () => {
    const c = client();
    const id = ulid();
    await c.createCapture({ id, text: 'call Priya kal 20 min' });
    await settle();
    expect((await c.getCapture(id)).status).toBe('enriched');
    const item = (await c.listItems()).items.find((i) => i.captureId === id)!;
    expect(item.type.value).toBe('task');
    expect(item.effort.value).toBe('small');
    expect(item.dueAt.value).toBeTruthy();
    expect(item.dueAt.decidedBy).toBe('t0');
  });

  it('asks instead of guessing when the type is unclear', async () => {
    const c = client();
    c.reset(true);
    await c.createCapture({ id: ulid(), text: 'that pricing thing' });
    await settle();
    const [q] = await c.listQuestions();
    expect(q?.field).toBe('type');
    await c.answerQuestion(q!.id, { option: 'idea' });
    const item = await c.getItem(q!.itemId!);
    expect(item.type).toMatchObject({ value: 'idea', decidedBy: 't3' });
    expect(await c.listQuestions()).toEqual([]);
  });

  it('refuses a future timestamp by replacing it, never the capture', async () => {
    const c = client();
    const { capture } = await c.createCapture({ id: ulid(), text: 'x', capturedAt: '2999-01-01T00:00:00Z' });
    expect(new Date(capture.capturedAt).getFullYear()).toBeLessThan(2999);
  });

  it('rejects lowercase ids and unknown ids look like 404', async () => {
    const c = client();
    await expect(c.createCapture({ id: ulid().toLowerCase(), text: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(c.getItem(ulid())).rejects.toMatchObject({ status: 404 });
  });

  it('a blocks cycle is a 409', async () => {
    const c = client();
    const items = (await c.listItems({ status: 'open' })).items;
    const [a, b] = items;
    await c.createEdge({ id: ulid(), from: a!.id, to: b!.id, kind: 'blocks' });
    const err = await c.createEdge({ id: ulid(), from: b!.id, to: a!.id, kind: 'blocks' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'cycle', kind: 'conflict' });
  });

  it('a user edit is decided by the user; confirming an edge makes it user-sourced', async () => {
    const c = client();
    const [it1] = (await c.listItems({ status: 'open' })).items;
    const edited = await c.updateItem(it1!.id, { effort: 'xlarge' });
    expect(edited.effort).toMatchObject({ value: 'xlarge', decidedBy: 'user', confidence: 1 });
    const [sug] = await c.listEdges({ confirmed: false });
    const confirmed = await c.confirmEdge(sug!.id);
    expect(confirmed).toMatchObject({ confirmed: true, suggestedBy: 'user' });
  });

  it('a rejected suggestion is gone', async () => {
    const c = client();
    const before = await c.listEdges({ confirmed: false });
    await c.rejectEdge(before[0]!.id);
    expect((await c.listEdges({ confirmed: false })).length).toBe(before.length - 1);
  });

  it('server down is a retryable 503', async () => {
    const c = client();
    c.setServerDown(true);
    const err = await c.getPlan().catch((e) => e);
    expect(err).toMatchObject({ status: 503, kind: 'unavailable', retryable: true });
  });

  it('paginates with nextCursor', async () => {
    const c = client();
    const p1 = await c.listItems({ limit: 5 });
    expect(p1.items).toHaveLength(5);
    const p2 = await c.listItems({ limit: 5, after: p1.nextCursor! });
    expect(p2.items[0]!.id > p1.items[4]!.id).toBe(true);
  });
});
