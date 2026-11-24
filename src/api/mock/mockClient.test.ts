import { afterEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { MockBrainClient } from './mockClient';
import { ApiError } from '../client';

const make = () => new MockBrainClient({ storageKey: null, latencyMs: [0, 0], enrichDelayMs: [0, 0] });
const settle = () => new Promise((r) => setTimeout(r, 5));
let clients: MockBrainClient[] = [];
afterEach(() => { clients.forEach((c) => c.dispose()); clients = []; });
const client = () => { const c = make(); clients.push(c); return c; };

describe('questions (T3), as the server stores and answers them', () => {
  const ask = async () => {
    const c = client();
    c.reset(true);
    const capture = await c.createCapture({ id: ulid(), text: 'that pricing thing for Brain' });
    await c.createCapture({ id: ulid(), text: 'buy milk' });
    await settle();
    const qs = await c.listQuestions();
    return { c, q: qs[0]!, qs, captureId: capture.capture.id };
  };

  it('asks only when the type cannot be read, with Brain\'s prompt and options', async () => {
    const { qs, q, captureId } = await ask();
    expect(qs).toHaveLength(1);
    expect(q).toMatchObject({ field: 'type', prompt: 'What is “That pricing thing for Brain”?', options: ['task', 'idea', 'note', 'reminder', 'link'], captureId });
    expect(q.itemId).toBeTruthy();
    expect(q.createdAt).toBeTruthy();
    expect(q).not.toHaveProperty('answer');
  });

  it('an answer sets the type as the user\'s decision and closes the question', async () => {
    const { c, q } = await ask();
    await c.answerQuestion(q.id, { option: 'note' });
    expect((await c.getItem(q.itemId)).type).toMatchObject({ value: 'note', decidedBy: 'user' });
    expect(await c.listQuestions()).toEqual([]);
    expect(c.snapshot().corrections.at(-1)).toMatchObject({ field: 'type', afterValue: 'note', tier: 't3' });
  });

  it('the same answer again is fine and changes nothing; a different one is 409', async () => {
    const { c, q } = await ask();
    await c.answerQuestion(q.id, { option: 'note' });
    const n = c.snapshot().corrections.length;
    await c.answerQuestion(q.id, { option: 'note' });
    expect(c.snapshot().corrections).toHaveLength(n);
    await expect(c.answerQuestion(q.id, { option: 'task' })).rejects.toMatchObject({ status: 409, code: 'already_answered' });
  });

  it('only one of the offered options is an answer; unknown questions are 404', async () => {
    const { c, q } = await ask();
    await expect(c.answerQuestion(q.id, { option: 'Note' })).rejects.toMatchObject({ status: 400, code: 'not_an_option' });
    await expect(c.answerQuestion(ulid(), { option: 'task' })).rejects.toMatchObject({ status: 404 });
  });

  it('setting the type on the item answers the question too', async () => {
    const { c, q } = await ask();
    await c.updateItem(q.itemId, { type: 'idea' });
    expect(await c.listQuestions()).toEqual([]);
    await expect(c.answerQuestion(q.id, { option: 'task' })).rejects.toMatchObject({ code: 'already_answered' });
  });
});

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

  it('never assigns a goal, and links only what Brain would', async () => {
    const c = client();
    c.reset(true);
    await c.createGoal({ id: ulid(), title: 'Brain' });
    await c.createCapture({ id: ulid(), text: 'buy milk' });
    await c.createCapture({ id: ulid(), text: 'buy milk today' }); // overlap 0.667: under Brain's 0.7
    await c.createCapture({ id: ulid(), text: 'call plumber' });
    await settle();
    expect(await c.listEdges()).toEqual([]);
    expect((await c.listItems()).items.every((i) => !i.goal.value)).toBe(true);
  });

  it('suggests at most one duplicate, unconfirmed, as Brain does', async () => {
    const c = client();
    c.reset(true);
    await c.createCapture({ id: ulid(), text: 'renew car insurance policy' });
    await settle();
    await c.createCapture({ id: ulid(), text: 'Renew car insurance policy!' });
    await settle();
    const edges = await c.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ kind: 'duplicate', confirmed: false, suggestedBy: 't0Rule', confidence: 1 });
    const items = (await c.listItems()).items;
    expect(edges[0]!.from).toBe(items[1]!.id);
    expect(edges[0]!.to).toBe(items[0]!.id);
  });

  it('compares links whole: two different links on one site are not duplicates', async () => {
    const c = client();
    c.reset(true);
    await c.createCapture({ id: ulid(), text: 'https://example.com/blog/a-post?ref=x' });
    await settle();
    await c.createCapture({ id: ulid(), text: 'https://example.com/blog/b-post?ref=x' });
    await settle();
    expect(await c.listEdges()).toEqual([]);
  });
  it('proposes a blocks link only from an explicit "after X", unconfirmed', async () => {
    const c = client();
    c.reset(true);
    await c.createCapture({ id: ulid(), text: 'update resume' });
    await settle();
    await c.createCapture({ id: ulid(), text: 'apply to jobs after update resume' });
    await settle();
    const [e] = await c.listEdges();
    expect(e).toMatchObject({ kind: 'blocks', confirmed: false, suggestedBy: 't0Rule' });
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
    const [, , a, b] = items;
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
