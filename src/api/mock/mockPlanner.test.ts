import { afterEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { MockBrainClient } from './mockClient';
import type { NewCommitment } from '../types';

// Tuesday 24 November 2026, 11:30 in Kolkata.
const NOW = new Date('2026-11-24T06:00:00Z');
let clients: MockBrainClient[] = [];
afterEach(() => { clients.forEach((c) => c.dispose()); clients = []; });
const client = () => {
  const c = new MockBrainClient({ storageKey: null, latencyMs: [0, 0], enrichDelayMs: [0, 0], now: () => NOW, empty: true });
  clients.push(c);
  return c;
};
const commit = (c: MockBrainClient, o: Partial<NewCommitment> = {}) =>
  c.createCommitment({ id: ulid(), title: 'Read 10 pages', kind: 'habit', rule: { kind: 'daily' }, minutes: 20, startOn: '2026-11-01', paused: false, ...o });
const item = async (c: MockBrainClient, text: string) => {
  await c.createCapture({ id: ulid(), text });
  await new Promise((r) => setTimeout(r, 5));
  return (await c.listItems()).items.find((i) => i.title.toLowerCase().includes(text.split(' ')[0]!.toLowerCase()))!;
};

describe('the plan keeps commitments out of the ranking', () => {
  it('returns them as their own section with the day and minutes still owed', async () => {
    const c = client();
    const read = await commit(c);
    await commit(c, { title: 'Pay rent', kind: 'payment', rule: { kind: 'monthlyOnDay', day: 24 }, minutes: 5, note: '22k' });
    await item(c, 'call the plumber 10 min');
    const plan = await c.getPlan();
    expect(plan.day).toBe('2026-11-24');
    expect(plan.commitments.map((s) => s.commitment.title)).toEqual(['Pay rent', 'Read 10 pages']);
    expect(plan.ranked.some((r) => r.item.title === 'Read 10 pages')).toBe(false);
    expect(plan.committedMinutes).toBe(25);
    await c.setOccurrence(read.id, '2026-11-24', { state: 'done' });
    expect((await c.getPlan()).committedMinutes).toBe(5);
  });

  it('shows a moved occurrence on its new day, marked with where it came from', async () => {
    const c = client();
    const read = await commit(c);
    await c.setOccurrence(read.id, '2026-11-23', { state: 'moved', movedTo: '2026-11-24' });
    const plan = await c.getPlan();
    expect(plan.commitments.find((s) => s.movedFrom)).toMatchObject({ movedFrom: '2026-11-23' });
    const occ = await c.listOccurrences({ from: '2026-11-23', through: '2026-11-24' });
    expect(occ.filter((o) => (o.movedTo ?? o.day) === '2026-11-24')).toHaveLength(2);
  });
});

describe('occurrences follow the server’s rules', () => {
  it('refuses done for a day that has not come, and a day the rule does not fall on', async () => {
    const c = client();
    const sunday = await commit(c, { title: 'Weekly review', kind: 'ritual', rule: { kind: 'weeklyOn', weekday: 'sunday' } });
    await expect(c.setOccurrence(sunday.id, '2026-11-29', { state: 'done' })).rejects.toMatchObject({ code: 'in_future' });
    await expect(c.setOccurrence(sunday.id, '2026-11-24', { state: 'done' })).rejects.toMatchObject({ code: 'not_scheduled' });
    await expect(c.setOccurrence(sunday.id, '2026-11-22', { state: 'moved' })).rejects.toMatchObject({ code: 'invalid_move' });
  });

  it('a done after a move counts for the original day, and undo clears it', async () => {
    const c = client();
    const read = await commit(c);
    await c.setOccurrence(read.id, '2026-11-23', { state: 'moved', movedTo: '2026-11-24' });
    const done = await c.setOccurrence(read.id, '2026-11-23', { state: 'done' });
    expect(done).toMatchObject({ day: '2026-11-23', state: 'done', movedTo: '2026-11-24' });
    expect((await c.getCommitment(read.id)).streak).toBe(1);
    await c.clearOccurrence(read.id, '2026-11-23');
    expect((await c.getCommitment(read.id)).streak).toBe(0);
  });

  it('caps a range at 92 days', async () => {
    const c = client();
    await expect(c.listOccurrences({ from: '2026-01-01', through: '2026-04-03' })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(c.listOccurrences({ from: '2026-10-01', through: '2026-12-31' })).resolves.toEqual([]);
  });
});

describe('the big task', () => {
  it('records a swap when the user picks something other than Brain’s proposal', async () => {
    const c = client();
    const a = await item(c, 'write the spec');
    const b = await item(c, 'book tickets');
    const plan = await c.confirmDailyPlan('2026-11-25', { itemId: b.id, proposedItemId: a.id });
    expect(plan).toMatchObject({ day: '2026-11-25', swapped: true });
    expect(c.snapshot().corrections.filter((x) => x.field === 'bigTask')).toHaveLength(1);
    expect((await c.confirmDailyPlan('2026-11-24', { itemId: a.id, proposedItemId: a.id })).swapped).toBe(false);
    expect((await c.getPlan()).bigTask?.itemId).toBe(a.id);
  });

  it('only yesterday, today or tomorrow, and only an open item', async () => {
    const c = client();
    const a = await item(c, 'write the spec');
    await expect(c.confirmDailyPlan('2026-11-27', { itemId: a.id })).rejects.toMatchObject({ code: 'day_out_of_range' });
    await c.updateItem(a.id, { status: 'done' });
    await expect(c.confirmDailyPlan('2026-11-24', { itemId: a.id })).rejects.toMatchObject({ code: 'item_not_open' });
  });
});

describe('review', () => {
  it('counts expected, done, skipped and missed; today is not missed yet', async () => {
    const c = client();
    const read = await commit(c, { startOn: '2026-11-18' });
    await c.setOccurrence(read.id, '2026-11-18', { state: 'done' });
    await c.setOccurrence(read.id, '2026-11-19', { state: 'skipped' });
    const r = await c.getReview({ from: '2026-11-18', through: '2026-11-24' });
    expect(r.commitments[0]).toMatchObject({ expected: 7, done: 1, skipped: 1, missed: 4 });
    expect(r.commitments[0]!.hitRate).toBeCloseTo(1 / 7);
  });

  it('rolls month goals into their quarter, and refuses a month in another quarter', async () => {
    const c = client();
    const q = await c.createGoal({ id: ulid(), title: 'iOS contract job', period: '2026-Q4' });
    await c.createGoal({ id: ulid(), title: 'Start the job hunt', period: '2026-11', parentId: q.id });
    await expect(c.createGoal({ id: ulid(), title: 'Wrong', period: '2027-01', parentId: q.id })).rejects.toMatchObject({ code: 'invalid_rollup' });
    const r = await c.getReview({ from: '2026-11-01', through: '2026-11-30' });
    const quarter = r.goals.find((g) => g.goal.id === q.id)!;
    expect(quarter.goal.periodText).toBe('Q4 2026');
    expect(quarter.children.map((x) => x.title)).toEqual(['Start the job hunt']);
    expect(await c.listGoals('2026-11')).toHaveLength(1);
  });
});

describe('journal', () => {
  it('one entry per day, replaced on write; not for a day that has not come', async () => {
    const c = client();
    await c.writeJournal('2026-11-24', 'one');
    await c.writeJournal('2026-11-24', 'two');
    expect(await c.listJournal({ from: '2026-11-24', through: '2026-11-24' })).toMatchObject([{ body: 'two' }]);
    await expect(c.writeJournal('2026-11-25', 'later')).rejects.toMatchObject({ code: 'in_future' });
  });
});

describe('what the plan holds (Brain 0.11.0)', () => {
  const add = async (c: MockBrainClient, text: string) => {
    const id = ulid();
    await c.createCapture({ id, text });
    await new Promise((r) => setTimeout(r, 5));
    return (await c.listItems()).items.find((i) => i.captureId === id)!;
  };

  it('ranks tasks, reminders, links and untyped items; never ideas or notes', async () => {
    const c = client();
    const task = await add(c, 'call the plumber');
    const link = await add(c, 'https://example.com/swift-concurrency');
    const untyped = await add(c, 'that pricing thing');
    const idea = await add(c, 'idea: reels on graph algorithms');
    const note = await add(c, 'note: landlord deposit was 40k');
    expect([task.type.value, link.type.value, untyped.type.value, idea.type.value, note.type.value]).toEqual(['task', 'link', undefined, 'idea', 'note']);
    const plan = await c.getPlan();
    const ids = new Set([...plan.ranked, ...plan.quickWins].map((r) => r.item.id));
    expect(ids.has(task.id) && ids.has(link.id) && ids.has(untyped.id)).toBe(true);
    expect(ids.has(idea.id) || ids.has(note.id)).toBe(false);
    expect(plan.next?.item.type.value).not.toBe('idea');
    // /v1/items still returns everything.
    expect((await c.listItems()).items.map((i) => i.id)).toEqual(expect.arrayContaining([idea.id, note.id]));
  });

  it('an open idea still blocks a task and is named as its blocker, but is never listed as blocked', async () => {
    const c = client();
    const idea = await add(c, 'idea: pick a backend language');
    const task = await add(c, 'write the API skeleton');
    const blockedIdea = await add(c, 'idea: a CLI for Brain');
    const e1 = await c.createEdge({ id: ulid(), from: idea.id, to: task.id, kind: 'blocks' });
    const e2 = await c.createEdge({ id: ulid(), from: task.id, to: blockedIdea.id, kind: 'blocks' });
    expect(e1.confirmed && e2.confirmed).toBe(true);
    const plan = await c.getPlan();
    expect(plan.blocked).toEqual([expect.objectContaining({ item: expect.objectContaining({ id: task.id }), blockedBy: [idea.id] })]);
  });

  it('refuses an idea or a note as the big task, or as Brain’s proposal', async () => {
    const c = client();
    const task = await add(c, 'call the plumber');
    const idea = await add(c, 'idea: reels on graph algorithms');
    const note = await add(c, 'note: landlord deposit was 40k');
    await expect(c.confirmDailyPlan('2026-11-24', { itemId: idea.id, proposedItemId: task.id })).rejects.toMatchObject({ status: 400, code: 'item_not_actionable' });
    await expect(c.confirmDailyPlan('2026-11-24', { itemId: task.id, proposedItemId: note.id })).rejects.toMatchObject({ status: 400, code: 'item_not_actionable' });
    // Made a task, an idea is planned like any other.
    await c.updateItem(idea.id, { type: 'task' });
    expect((await c.getPlan()).ranked.some((r) => r.item.id === idea.id)).toBe(true);
    await expect(c.confirmDailyPlan('2026-11-24', { itemId: idea.id, proposedItemId: task.id })).resolves.toMatchObject({ swapped: true });
  });
});
