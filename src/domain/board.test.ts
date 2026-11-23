import { describe, expect, it } from 'vitest';
import { buildBoard, reorder } from './board';
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
    const order = reorder(buildBoard(base), 'q2', -1);
    expect(buildBoard({ ...base, order })[2]!.slots.map((x) => x.item.id)).toEqual(['q2', 'q1']);
  });
});
