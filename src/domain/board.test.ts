import { describe, expect, it } from 'vitest';
import { buildBoard, moveStep, moveTo } from './board';
import type { Item, RankedItem } from '../api/types';

const mk = (id: string, effort: Item['effort']['value'], status: Item['status'] = 'open'): Item => ({
  id, title: id, status,
  type: { value: 'task', confidence: 1, decidedBy: 't0' },
  effort: effort ? { value: effort, confidence: 1, decidedBy: 'user' } : { confidence: 0, decidedBy: 't0' },
  dueAt: { confidence: 0, decidedBy: 't0' }, goal: { confidence: 0, decidedBy: 't0' }, category: { confidence: 0, decidedBy: 't0' },
  createdAt: '', updatedAt: '',
});
const r = (i: Item): RankedItem => ({ item: i, reason: '', why: { unblocks: 0, mayUnblock: 0, servesGoals: 0, mayServeGoals: 0, duePressure: 0 } });

describe('1-3-5 board is a projection, never a re-rank', () => {
  const ranked = [mk('q1', 'tiny'), mk('m1', 'medium'), mk('b1', 'large'), mk('q2', 'small'), mk('b2', 'xlarge'), mk('u1', undefined)].map(r);
  const base = { ranked, blockedIds: new Set<string>(), doneToday: [], notNow: new Set<string>(), order: [] };

  it('buckets by effort and keeps the server order', () => {
    const [big, med, quick] = buildBoard(base);
    expect(big!.slots.map((x) => x.item.id)).toEqual(['b1']);
    expect(big!.overflow.map((x) => x.item.id)).toEqual(['b2']);
    expect(med!.slots.map((x) => x.item.id)).toEqual(['m1', 'u1']);
    expect(quick!.slots.map((x) => x.item.id)).toEqual(['q1', 'q2']);
  });
  it('under-fills instead of padding', () => {
    expect(buildBoard(base)[1]!.slots.length).toBe(2);
  });
  it('drops blocked and not-now items; done items keep their slot', () => {
    const [big, , quick] = buildBoard({ ...base, blockedIds: new Set(['b1']), notNow: new Set(['q1']), doneToday: [mk('d1', 'tiny', 'done')] });
    expect(big!.slots.map((x) => x.item.id)).toEqual(['b2']);
    expect(quick!.slots.map((x) => [x.item.id, x.done])).toEqual([['d1', true], ['q2', false]]);
  });
  it('a manual order wins inside a bucket', () => {
    const m = moveStep(buildBoard(base), 'q2', -1)!;
    expect(m.to).toBeUndefined();
    expect(buildBoard({ ...base, order: m.order })[2]!.slots.map((x) => x.item.id)).toEqual(['q2', 'q1']);
  });
  it('up from the top of a group lands at the bottom of the group above', () => {
    const m = moveStep(buildBoard(base), 'q1', -1)!;
    expect(m.to).toBe('medium');
    const [, med, quick] = buildBoard({ ...base, order: m.order, moved: { q1: m.to! } });
    expect(med!.slots.map((x) => x.item.id)).toEqual(['m1', 'u1', 'q1']);
    expect(quick!.slots.map((x) => x.item.id)).toEqual(['q2']);
  });
  it('down from the bottom of a group lands at the top of the group below', () => {
    const m = moveStep(buildBoard(base), 'b2', 1)!;
    expect(m.to).toBe('medium');
    const [big, med] = buildBoard({ ...base, order: m.order, moved: { b2: m.to! } });
    expect(big!.overflow).toEqual([]);
    expect(med!.slots.map((x) => x.item.id)).toEqual(['b2', 'm1', 'u1']);
  });
  it('the board ends are walls', () => {
    expect(moveStep(buildBoard(base), 'b1', -1)).toBeNull();
    expect(moveStep(buildBoard(base), 'q2', 1)).toBeNull();
  });
  it('move-to takes a free slot, or queues first behind full slots', () => {
    const m = moveTo(buildBoard(base), 'q1', 'medium');
    expect(buildBoard({ ...base, order: m.order, moved: { q1: 'medium' } })[1]!.slots.map((x) => x.item.id)).toEqual(['m1', 'u1', 'q1']);
    const full = moveTo(buildBoard(base), 'q1', 'big');
    const [big] = buildBoard({ ...base, order: full.order, moved: { q1: 'big' } });
    expect(big!.slots.map((x) => x.item.id)).toEqual(['b1']);
    expect(big!.overflow.map((x) => x.item.id)).toEqual(['q1', 'b2']);
  });
  it('moving does not change the item’s effort', () => {
    const m = moveTo(buildBoard(base), 'q1', 'big');
    const row = buildBoard({ ...base, order: m.order, moved: { q1: 'big' } })[0]!.overflow[0]!;
    expect(row.item.effort.value).toBe('tiny');
  });
});
