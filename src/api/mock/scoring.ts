/**
 * MOCK SERVER ONLY. A TypeScript port of Brain's T0 scoring
 * (Brain/docs/02-scoring-spec.md) so the fake server can answer /v1/plan
 * while the real one returns 501.
 *
 * The app itself never imports this file. Screens read `Plan` from the
 * BrainClient and never rank anything. If this ever disagrees with Brain,
 * Brain is right.
 */
import type { BlockedItem, Edge, Goal, Item, Plan, RankedItem, Why } from '../types';
import { EFFORT_LABEL, EFFORT_MINUTES } from '../../domain/labels';
import { dayKey, daysBetween } from '../../domain/time';
import { periodBounds } from '../../domain/period';

const W = { b: 0.5, u: 1.0, g: 1.5, d: 0.8 };
const DEPTH_CAP = 5;

/**
 * Brain 0.11.0 `Scoring.appearsInPlan`: the plan holds tasks, reminders,
 * links, and items whose type is not known yet. Ideas and notes stay in the
 * graph (they still block, serve goals and count as blockers) but are never
 * ranked, proposed or listed as blocked.
 */
export function appearsInPlan(item: Item): boolean {
  const t = item.type.value;
  return t !== 'idea' && t !== 'note';
}

export const effortDenominator = (minutes: number) => Math.log(1 + minutes) / Math.log(1 + 20);

export function duePressure(item: Item, now: Date, tz: string): number {
  const due = item.dueAt;
  // Only T0-parsed or user-set dates create pressure. A model's guess never does.
  if (!due.value || (due.decidedBy !== 't0' && due.decidedBy !== 'user' && due.decidedBy !== 't3')) return 0;
  const days = daysBetween(dayKey(now, tz), dayKey(new Date(due.value), tz));
  if (days <= 0) return 1;
  return Math.max(0, 1 - days / 14);
}

export function leverage(U: number, G: number, D: number, minutes: number): number {
  return (W.b + W.u * Math.log(1 + U) + W.g * Math.log(1 + G) + W.d * D) / effortDenominator(minutes);
}

interface Graph {
  open: Map<string, Item>;
  blocksOut: { confirmed: Map<string, string[]>; any: Map<string, string[]> };
  servesGoals: { confirmed: Map<string, Set<string>>; any: Map<string, Set<string>> };
}

function buildGraph(items: Item[], edges: Edge[], counting: Set<string> | null = null): Graph {
  const open = new Map(items.filter((i) => i.status === 'open').map((i) => [i.id, i]));
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  const g: Graph = {
    open,
    blocksOut: { confirmed: new Map(), any: new Map() },
    servesGoals: { confirmed: new Map(), any: new Map() },
  };
  for (const i of items) {
    if (i.goal.value && (!counting || counting.has(i.goal.value))) {
      add(g.servesGoals.any, i.id, i.goal.value);
      // A goal the item was given, by anyone, counts; an edge needs confirming.
      add(g.servesGoals.confirmed, i.id, i.goal.value);
    }
  }
  for (const e of edges) {
    if (e.kind === 'blocks') {
      push(g.blocksOut.any, e.from, e.to);
      if (e.confirmed) push(g.blocksOut.confirmed, e.from, e.to);
    } else if (e.kind === 'serves') {
      add(g.servesGoals.any, e.from, e.to);
      if (e.confirmed) add(g.servesGoals.confirmed, e.from, e.to);
    }
  }
  return g;
}

/** Open items reachable through `blocks`, depth-capped. */
function reachable(start: string, out: Map<string, string[]>, open: Map<string, Item>): Set<string> {
  const seen = new Set<string>();
  let frontier = [start];
  for (let depth = 0; depth < DEPTH_CAP && frontier.length; depth++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of out.get(n) ?? []) {
        if (m === start || seen.has(m) || !open.has(m)) continue;
        seen.add(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  return seen;
}

function goalsOf(ids: Iterable<string>, serves: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) for (const g of serves.get(id) ?? []) out.add(g);
  return out;
}

/**
 * Brain's `Goal.counts(on:)`: an active goal counts, unless its period has
 * already ended. Future-period goals count; open-ended ones always do.
 */
export function goalCounts(goal: Goal, today: string): boolean {
  if (goal.status !== 'active') return false;
  return !goal.period || today <= periodBounds(goal.period).through;
}

/** The ranked half of the plan. Commitments are added by the caller, never ranked. */
export type RankedPlan = Pick<Plan, 'next' | 'ranked' | 'quickWins' | 'blocked' | 'computedAt'>;

export function computePlan(items: Item[], edges: Edge[], now: Date, tz: string, goals?: Goal[]): RankedPlan {
  const today = dayKey(now, tz);
  const counting = goals ? new Set(goals.filter((x) => goalCounts(x, today)).map((x) => x.id)) : null;
  const g = buildGraph(items, counting ? edges.filter((e) => e.kind !== 'serves' || counting.has(e.to)) : edges, counting);
  const candidates = [...g.open.values()].filter(appearsInPlan);

  const scored = candidates.map((item) => {
    const uC = reachable(item.id, g.blocksOut.confirmed, g.open);
    const uAny = reachable(item.id, g.blocksOut.any, g.open);
    const gC = goalsOf([item.id, ...uC], g.servesGoals.confirmed);
    const gAny = goalsOf([item.id, ...uAny], g.servesGoals.any);
    const effort = item.effort.value ?? 'unknown';
    const minutes = EFFORT_MINUTES[effort];
    const D = duePressure(item, now, tz);
    const why: Why = {
      unblocks: uC.size,
      mayUnblock: uAny.size - uC.size,
      servesGoals: gC.size,
      mayServeGoals: gAny.size - gC.size,
      duePressure: Math.round(D * 1000) / 1000,
    };
    // α = 0 (the spec's default): unconfirmed links do not move the score.
    const score = leverage(uC.size, gC.size, D, minutes);
    return { item, why, score, minutes, effort, D };
  });

  scored.sort((a, b) =>
    b.score - a.score
    || cmpNullsLast(a.item.dueAt.value, b.item.dueAt.value)
    || a.minutes - b.minutes
    || a.item.createdAt.localeCompare(b.item.createdAt)
    || a.item.id.localeCompare(b.item.id));

  const toRanked = (s: (typeof scored)[number]): RankedItem => ({
    item: s.item,
    why: s.why,
    reason: reasonText(s.why, s.effort, s.item, now, tz),
  });
  const ranked = scored.map(toRanked);

  const blockers = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'blocks' || !e.confirmed) continue;
    if (!g.open.has(e.from) || !g.open.has(e.to)) continue;
    blockers.set(e.to, [...(blockers.get(e.to) ?? []), e.from]);
  }
  // Blocked derives from the ranked list, so only what the plan holds; the
  // blocker itself may be an idea or a note, and is still named.
  const blocked: BlockedItem[] = [...blockers.entries()]
    .filter(([id]) => appearsInPlan(g.open.get(id)!))
    .map(([id, by]) => ({ item: g.open.get(id)!, blockedBy: by }))
    .sort((a, b) => a.item.id.localeCompare(b.item.id));

  const median = medianOf(scored.map((s) => s.score));
  const quickWins = scored
    .filter((s) => (s.effort === 'tiny' || s.effort === 'small') && s.score >= median && !blockers.has(s.item.id))
    .map(toRanked);

  const next = ranked.find((r) => !blockers.has(r.item.id));
  return { ...(next ? { next } : {}), ranked, quickWins, blocked, computedAt: now.toISOString() };
}

function cmpNullsLast(a?: string, b?: string): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The T0 template: "Unblocks {U} tasks · serves {G} goals · {effort} · {due}". */
function reasonText(why: Why, effort: keyof typeof EFFORT_LABEL, item: Item, now: Date, tz: string): string {
  const parts: string[] = [];
  if (why.unblocks) parts.push(`Unblocks ${why.unblocks} task${why.unblocks === 1 ? '' : 's'}`);
  if (why.servesGoals) parts.push(`serves ${why.servesGoals} goal${why.servesGoals === 1 ? '' : 's'}`);
  parts.push(EFFORT_LABEL[effort]);
  if (item.dueAt.value && why.duePressure > 0) {
    const days = daysBetween(dayKey(now, tz), dayKey(new Date(item.dueAt.value), tz));
    parts.push(days < 0 ? 'overdue' : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`);
  }
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** True if adding from→to as `blocks` would close a cycle (to already reaches from). */
export function wouldCycle(from: string, to: string, edges: Edge[]): boolean {
  if (from === to) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) if (e.kind === 'blocks') out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) ?? []));
  }
  return false;
}
