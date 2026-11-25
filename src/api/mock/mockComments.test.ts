import { afterEach, describe, expect, it } from 'vitest';
import { monotonicFactory } from 'ulid';

// Ordered ids: with a frozen clock, ties break by id, as on the server.
const ulid = monotonicFactory();
import { MockBrainClient } from './mockClient';

// Tuesday 24 November 2026, 11:30 in Kolkata.
const NOW = new Date('2026-11-24T06:00:00Z');
let clients: MockBrainClient[] = [];
afterEach(() => { clients.forEach((c) => c.dispose()); clients = []; });
const client = () => {
  const c = new MockBrainClient({ storageKey: null, latencyMs: [0, 0], enrichDelayMs: [0, 0], now: () => NOW, empty: true });
  clients.push(c);
  return c;
};
const goal = (c: MockBrainClient, targetCount?: number) =>
  c.createGoal({ id: ulid(), title: 'Ship 6 reels', period: '2026-Q4', ...(targetCount !== undefined ? { targetCount } : {}) });

describe('comments, as the server stores them (S7)', () => {
  it('lists one target’s comments oldest first; idempotent on id', async () => {
    const c = client();
    const g = await goal(c);
    const first = await c.createComment({ id: ulid(), goalId: g.id, body: 'first' });
    await c.createComment({ id: ulid(), goalId: g.id, body: 'second' });
    const again = await c.createComment({ id: first.id, goalId: g.id, body: 'changed?' });
    expect(again.body).toBe('first');
    expect((await c.listComments({ goalId: g.id })).map((x) => x.body)).toEqual(['first', 'second']);
  });

  it('names exactly one target, and it must exist', async () => {
    const c = client();
    const g = await goal(c);
    await expect(c.listComments({} as never)).rejects.toMatchObject({ status: 400, code: 'one_target' });
    await expect(c.createComment({ id: ulid(), goalId: g.id, itemId: ulid(), body: 'x' })).rejects.toMatchObject({ code: 'one_target' });
    await expect(c.createComment({ id: ulid(), itemId: ulid(), body: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(c.createComment({ id: ulid(), goalId: g.id, body: '' })).rejects.toMatchObject({ code: 'empty_body' });
    await expect(c.createComment({ id: ulid(), goalId: g.id, body: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'body_too_long' });
  });

  it('rewrites and deletes; a missing one is 404', async () => {
    const c = client();
    const g = await goal(c);
    const x = await c.createComment({ id: ulid(), goalId: g.id, body: 'draft' });
    expect((await c.updateComment(x.id, { body: 'final' })).body).toBe('final');
    await c.deleteComment(x.id);
    expect(await c.listComments({ goalId: g.id })).toEqual([]);
    await expect(c.deleteComment(x.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('count goals (S7): circles, never money', () => {
  it('a count goal carries targetCount and doneCount; an ordinary goal carries neither', async () => {
    const c = client();
    const plain = await goal(c);
    const counted = await goal(c, 6);
    expect(plain).not.toHaveProperty('doneCount');
    expect(counted).toMatchObject({ targetCount: 6, doneCount: 0 });
    await expect(goal(c, 0)).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(goal(c, 1001)).rejects.toMatchObject({ code: 'invalid_target' });
  });

  it('fills circles for today by default, oldest day first; idempotent on id', async () => {
    const c = client();
    const g = await goal(c, 3);
    const m = await c.addGoalMark(g.id, { id: ulid(), note: 'graphs reel' });
    expect(m.day).toBe('2026-11-24');
    await c.addGoalMark(g.id, { id: ulid(), day: '2026-11-20' });
    await c.addGoalMark(g.id, { id: m.id }); // a retry, not a third circle
    expect((await c.listGoalMarks(g.id)).map((x) => x.day)).toEqual(['2026-11-20', '2026-11-24']);
    expect((await c.listGoals()).find((x) => x.id === g.id)?.doneCount).toBe(2);
  });

  it('refuses the future, an ordinary goal and a full one; filling the last does not achieve it', async () => {
    const c = client();
    const g = await goal(c, 1);
    await expect(c.addGoalMark(g.id, { id: ulid(), day: '2026-11-25' })).rejects.toMatchObject({ code: 'in_future' });
    await expect(c.addGoalMark((await goal(c)).id, { id: ulid() })).rejects.toMatchObject({ status: 400, code: 'not_a_count_goal' });
    await c.addGoalMark(g.id, { id: ulid() });
    await expect(c.addGoalMark(g.id, { id: ulid() })).rejects.toMatchObject({ status: 409, code: 'target_reached' });
    expect((await c.listGoals()).find((x) => x.id === g.id)?.status).toBe('active');
  });

  it('a note can be changed or cleared; a circle can be emptied', async () => {
    const c = client();
    const g = await goal(c, 2);
    const m = await c.addGoalMark(g.id, { id: ulid(), note: 'a' });
    expect((await c.updateGoalMark(g.id, m.id, { note: 'b' })).note).toBe('b');
    expect(await c.updateGoalMark(g.id, m.id, { clear: ['note'] })).not.toHaveProperty('note');
    await expect(c.updateGoalMark(g.id, m.id, { note: 'c', clear: ['note'] })).rejects.toMatchObject({ code: 'conflicting_clear' });
    await c.deleteGoalMark(g.id, m.id);
    await expect(c.deleteGoalMark(g.id, m.id)).rejects.toMatchObject({ status: 404 });
  });

  it('the target can’t drop below what is filled, or be removed while any are', async () => {
    const c = client();
    const g = await goal(c, 3);
    await c.addGoalMark(g.id, { id: ulid() });
    await c.addGoalMark(g.id, { id: ulid() });
    await expect(c.updateGoal(g.id, { targetCount: 1, title: 'renamed' })).rejects.toMatchObject({ code: 'target_below_done' });
    expect((await c.listGoals())[0]!.title).toBe('Ship 6 reels'); // refused as a whole
    await expect(c.updateGoal(g.id, { clear: ['targetCount'] })).rejects.toMatchObject({ code: 'target_below_done' });
    expect(await c.updateGoal(g.id, { targetCount: 2 })).toMatchObject({ targetCount: 2, doneCount: 2 });
    const plain = await goal(c, 4);
    expect(await c.updateGoal(plain.id, { clear: ['targetCount'] })).not.toHaveProperty('targetCount');
  });
});
