/**
 * Goal periods: a month (`2026-11`) or a calendar quarter (`2026-Q4`, Q1 is
 * January to March; Brain docs/15-planner.md, D3). Pure calendar arithmetic
 * on day keys, used to group and label goals and to pick review ranges. It
 * never decides anything about a goal: the server owns rollup rules.
 */
import type { Period } from '../api/types';
import { addDaysToKey, MONTHS, type DayKey } from './time';

const pad = (n: number) => String(n).padStart(2, '0');

export type Horizon = 'month' | 'quarter';

export interface ParsedPeriod { year: number; horizon: Horizon; index: number }

export function parsePeriod(p: Period): ParsedPeriod | null {
  const m = /^(\d{4})-(?:(0[1-9]|1[0-2])|Q([1-4]))$/.exec(p);
  if (!m) return null;
  return m[2] ? { year: +m[1]!, horizon: 'month', index: +m[2] } : { year: +m[1]!, horizon: 'quarter', index: +m[3]! };
}

export const monthOf = (day: DayKey): Period => day.slice(0, 7);
export function quarterOf(day: DayKey): Period {
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
}
export const quarterOfMonth = (month: Period): Period => quarterOf(`${month}-01`);

/** First and last day, inclusive. */
export function periodBounds(p: Period): { from: DayKey; through: DayKey } {
  const x = parsePeriod(p);
  if (!x) throw new Error(`not a period: ${p}`);
  const firstMonth = x.horizon === 'month' ? x.index : (x.index - 1) * 3 + 1;
  const months = x.horizon === 'month' ? 1 : 3;
  const from = `${x.year}-${pad(firstMonth)}-01`;
  const end = new Date(Date.UTC(x.year, firstMonth - 1 + months, 0));
  return { from, through: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}` };
}

/** "November 2026", "Q4 2026": the same text the server's `periodText` uses. */
export function periodLabel(p: Period): string {
  const x = parsePeriod(p);
  if (!x) return p;
  return x.horizon === 'month' ? `${MONTHS[x.index - 1]} ${x.year}` : `Q${x.index} ${x.year}`;
}

/** The months a quarter holds, or the month itself. */
export function monthsIn(p: Period): Period[] {
  const x = parsePeriod(p);
  if (!x) return [];
  if (x.horizon === 'month') return [p];
  const first = (x.index - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${x.year}-${pad(first + i)}`);
}

export function shiftPeriod(p: Period, n: number): Period {
  const x = parsePeriod(p);
  if (!x) return p;
  if (x.horizon === 'month') {
    const t = x.year * 12 + (x.index - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }
  const t = x.year * 4 + (x.index - 1) + n;
  return `${Math.floor(t / 4)}-Q${(t % 4) + 1}`;
}

/** Monday-to-Sunday week containing `day`, so the Sunday review closes its own week. */
export function weekOf(day: DayKey): { from: DayKey; through: DayKey } {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const from = addDaysToKey(day, -((dow + 6) % 7));
  return { from, through: addDaysToKey(from, 6) };
}

export function containsDay(p: Period, day: DayKey): boolean {
  const b = periodBounds(p);
  return day >= b.from && day <= b.through;
}
