import { describe, expect, it } from 'vitest';
import { computePlan, duePressure, leverage, wouldCycle } from './scoring';
import type { Edge, Item } from '../types';
import { zonedToInstant } from '../../domain/time';

const TZ = 'Asia/Kolkata';
// Monday 23 Nov 2026, 10:00 IST: the day Brain's docs use.
const NOW = zonedToInstant(2026, 11, 23, 10, 0, TZ);

let n = 0;
const id = () => `01JD${String(++n).padStart(22, '0')}`;
function item(title: string, o: Partial<{ effort: Item['effort']['value']; dueDays: number; goal: string; status: Item['status'] }> = {}): Item {
  return {
    id: id(), title, status: o.status ?? 'open',
    type: { value: 'task', confidence: 1, decidedBy: 't0' },
    effort: o.effort ? { value: o.effort, confidence: 1, decidedBy: 'user' } : { confidence: 0, decidedBy: 't0' },
    dueAt: o.dueDays !== undefined ? { value: zonedToInstant(2026, 11, 23 + o.dueDays, 18, 0, TZ).toISOString(), confidence: 1, decidedBy: 't0' } : { confidence: 0, decidedBy: 't0' },
    goal: o.goal ? { value: o.goal, confidence: 1, decidedBy: 'user' } : { confidence: 0, decidedBy: 't0' },
    category: { confidence: 0, decidedBy: 't0' },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}
const blocks = (from: Item, to: Item, confirmed = true): Edge =>
  ({ id: id(), from: from.id, to: to.id, kind: 'blocks', confidence: 1, suggestedBy: confirmed ? 'user' : 't0Rule', confirmed });

describe('leverage — the worked examples in Brain docs/02-scoring-spec.md', () => {
  it('A: Call plumber, tiny, nothing else → 0.850', () => {
    expect(leverage(0, 0, 0, 5)).toBeCloseTo(0.85, 2);
  });
  it('B: Finalize API spec, medium, due in 3 days, U=4, G=2 → 3.248', () => {
    expect(leverage(4, 2, 1 - 3 / 14, 60)).toBeCloseTo(3.248, 3);
  });
  it('C: Rewrite onboarding copy, large, U=1, G=1 → 1.239', () => {
    expect(leverage(1, 1, 0, 240)).toBeCloseTo(1.239, 3);
  });
});

describe('duePressure', () => {
  it('is 1 for due today and overdue, falls to 0 over 14 days, ignores model-guessed dates', () => {
    expect(duePressure(item('today', { dueDays: 0 }), NOW, TZ)).toBe(1);
    expect(duePressure(item('late', { dueDays: -2 }), NOW, TZ)).toBe(1);
    expect(duePressure(item('soon', { dueDays: 7 }), NOW, TZ)).toBeCloseTo(0.5, 5);
    expect(duePressure(item('far', { dueDays: 20 }), NOW, TZ)).toBe(0);
    const guessed = item('guessed', { dueDays: 0 });
    guessed.dueAt.decidedBy = 't2';
    expect(duePressure(guessed, NOW, TZ)).toBe(0);
  });
});

describe('computePlan', () => {
  it('ranks B > C > A, as the spec says', () => {
    const [g1, g2, g3] = [id(), id(), id()];
    const A = item('Call plumber', { effort: 'tiny' });
    const B = item('Finalize API spec', { effort: 'medium', dueDays: 3, goal: g1 });
    const xs = [1, 2, 3, 4].map((k) => item(`B dependent ${k}`, { effort: 'xlarge', goal: k === 1 ? g2 : undefined }));
    const C = item('Rewrite onboarding copy', { effort: 'large', goal: g3 });
    const Y = item('C dependent', { effort: 'xlarge' });
    const plan = computePlan([A, B, C, Y, ...xs], [...xs.map((x) => blocks(B, x)), blocks(C, Y)], NOW, TZ);
    const order = plan.ranked.map((r) => r.item.title).filter((t) => ['Call plumber', 'Finalize API spec', 'Rewrite onboarding copy'].includes(t));
    expect(order).toEqual(['Finalize API spec', 'Rewrite onboarding copy', 'Call plumber']);
    const b = plan.ranked.find((r) => r.item.id === B.id)!;
    expect(b.why).toMatchObject({ unblocks: 4, servesGoals: 2 });
    expect(b.reason).toBe('Unblocks 4 tasks · serves 2 goals · about an hour · due in 3 days');
    expect(plan.next?.item.id).toBe(B.id);
  });

  it('unconfirmed links show as "may", never in the score (α = 0)', () => {
    const a = item('a', { effort: 'small' });
    const b = item('b', { effort: 'small' });
    const plan = computePlan([a, b], [blocks(a, b, false)], NOW, TZ);
    const ra = plan.ranked.find((r) => r.item.id === a.id)!;
    expect(ra.why).toMatchObject({ unblocks: 0, mayUnblock: 1 });
    expect(plan.blocked).toEqual([]);
  });

  it('next skips a blocked item even if it ranks first', () => {
    const blocker = item('tiny blocker', { effort: 'xlarge' });
    const hub = item('urgent hub', { effort: 'tiny', dueDays: 0 });
    const plan = computePlan([blocker, hub], [blocks(blocker, hub)], NOW, TZ);
    expect(plan.blocked.map((b) => b.item.id)).toEqual([hub.id]);
    expect(plan.next?.item.id).toBe(blocker.id);
  });

  it('is a strict total order and deterministic', () => {
    const xs = Array.from({ length: 6 }, (_, k) => item(`same ${k}`, { effort: 'small' }));
    const p1 = computePlan(xs, [], NOW, TZ).ranked.map((r) => r.item.id);
    const p2 = computePlan([...xs].reverse(), [], NOW, TZ).ranked.map((r) => r.item.id);
    expect(p1).toEqual(p2);
    expect(p1).toEqual([...p1].sort());
  });

  it('done items are not ranked', () => {
    const plan = computePlan([item('finished', { status: 'done' })], [], NOW, TZ);
    expect(plan.ranked).toEqual([]);
    expect(plan.next).toBeUndefined();
  });
});

describe('wouldCycle', () => {
  it('refuses a loop and a self-loop', () => {
    const a = item('a'), b = item('b'), c = item('c');
    const edges = [blocks(a, b), blocks(b, c)];
    expect(wouldCycle(c.id, a.id, edges)).toBe(true);
    expect(wouldCycle(a.id, a.id, edges)).toBe(true);
    expect(wouldCycle(a.id, c.id, edges)).toBe(false);
  });
});
