/**
 * MOCK SERVER ONLY. A port of Brain's recurrence engine
 * (Brain/Sources/BrainCore/Commitment.swift) so the fake server can expand
 * commitments the way the real one does. The app never imports this: screens
 * show the days the server returns, they never work out a schedule.
 *
 * Calendar arithmetic on day keys ("YYYY-MM-DD"), never on instants, exactly
 * like Brain's `CalendarDay`. If this ever disagrees with Brain, Brain is right.
 */
import type { Commitment, CommitmentKind, Rule, Weekday } from '../types';
import { WEEKDAYS } from '../types';
import { addDaysToKey, type DayKey } from '../../domain/time';

const W_NAME: Record<Weekday, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

const ymd = (k: DayKey) => k.split('-').map(Number) as [number, number, number];

export function weekdayOf(k: DayKey): Weekday {
  const [y, m, d] = ymd(k);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export function lastDayOfMonth(k: DayKey): number {
  const [y, m] = ymd(k);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Which occurrence of its weekday within the month: the second Tuesday is 2. */
export const weekdayOrdinal = (k: DayKey) => Math.floor((ymd(k)[2] - 1) / 7) + 1;
const isFirstMonthOfQuarter = (k: DayKey) => (ymd(k)[1] - 1) % 3 === 0;

/** Whether the rule puts an occurrence on `day`, ignoring the active window. */
export function matches(rule: Rule, day: DayKey): boolean {
  switch (rule.kind) {
    case 'daily': return true;
    case 'weeklyOn': return weekdayOf(day) === rule.weekday;
    case 'monthlyOnDay': return ymd(day)[2] === Math.min(Math.max(rule.day ?? 1, 1), lastDayOfMonth(day));
    case 'monthlyOnNthWeekday': return weekdayOf(day) === rule.weekday && weekdayOrdinal(day) === rule.n;
    case 'quarterlyOnNthWeekday':
      return isFirstMonthOfQuarter(day) && weekdayOf(day) === rule.weekday && weekdayOrdinal(day) === rule.n;
  }
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** Brain's `RecurrenceRule.text`, word for word. */
export function ruleText(rule: Rule): string {
  switch (rule.kind) {
    case 'daily': return 'Every day';
    case 'weeklyOn': return `Every ${W_NAME[rule.weekday!]}`;
    case 'monthlyOnDay': return `Monthly on the ${ordinal(rule.day!)}`;
    case 'monthlyOnNthWeekday': return `Monthly on the ${ordinal(rule.n!)} ${W_NAME[rule.weekday!]}`;
    case 'quarterlyOnNthWeekday': return `Quarterly on the ${ordinal(rule.n!)} ${W_NAME[rule.weekday!]}`;
  }
}

/** The template fields expansion needs. */
export type Template = Pick<Commitment, 'id' | 'kind' | 'rule' | 'minutes' | 'startOn' | 'paused'> & { endOn?: DayKey | undefined };

export function falls(c: Template, day: DayKey): boolean {
  if (c.paused || day < c.startOn) return false;
  if (c.endOn && day > c.endOn) return false;
  return matches(c.rule, day);
}

export function days(c: Template, from: DayKey, through: DayKey): DayKey[] {
  if (c.paused || from > through) return [];
  const out: DayKey[] = [];
  let day = from > c.startOn ? from : c.startOn;
  const last = c.endOn && c.endOn < through ? c.endOn : through;
  while (day <= last) {
    if (matches(c.rule, day)) out.push(day);
    day = addDaysToKey(day, 1);
  }
  return out;
}

export function next(c: Template, onOrAfter: DayKey, horizon = 400): DayKey | undefined {
  if (c.paused) return undefined;
  let d = onOrAfter > c.startOn ? onOrAfter : c.startOn;
  for (let i = 0; i < horizon; i++) {
    if (c.endOn && d > c.endOn) return undefined;
    if (matches(c.rule, d)) return d;
    d = addDaysToKey(d, 1);
  }
  return undefined;
}

/** Consecutive done occurrences back from today. Today not yet done doesn't break it. */
export function streak(c: Template, completed: Set<DayKey>, today: DayKey): number {
  if (c.paused) return 0;
  let count = 0;
  let day = today;
  while (day >= c.startOn) {
    if (matches(c.rule, day)) {
      if (completed.has(day)) count++;
      else if (day !== today) break;
    }
    day = addDaysToKey(day, -1);
  }
  return count;
}

/** Done over expected; undefined when nothing was expected (a 0 would read as failure). */
export function hitRate(c: Template, completed: Set<DayKey>, from: DayKey, through: DayKey): number | undefined {
  const expected = days(c, from, through);
  if (!expected.length) return undefined;
  return expected.filter((d) => completed.has(d)).length / expected.length;
}

const KIND_ORDER: Record<CommitmentKind, number> = { payment: 0, ritual: 1, block: 2, habit: 3 };

/** A day's commitments in Brain's stable order: payments, rituals, blocks, habits; then id. */
export function scheduledOn<T extends Template>(all: T[], day: DayKey): T[] {
  return all
    .filter((c) => falls(c, day))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Exactly the fields the rule's shape uses, each in range (the server's `invalid_rule`). */
export function validRule(r: Rule): boolean {
  const has = { weekday: r.weekday !== undefined, day: r.day !== undefined, n: r.n !== undefined };
  const okW = r.weekday === undefined || WEEKDAYS.includes(r.weekday);
  switch (r.kind) {
    case 'daily': return !has.weekday && !has.day && !has.n;
    case 'weeklyOn': return has.weekday && okW && !has.day && !has.n;
    case 'monthlyOnDay': return !has.weekday && has.day && !has.n && r.day! >= 1 && r.day! <= 31;
    case 'monthlyOnNthWeekday':
    case 'quarterlyOnNthWeekday':
      return has.weekday && okW && !has.day && has.n && r.n! >= 1 && r.n! <= 5;
    default: return false;
  }
}
