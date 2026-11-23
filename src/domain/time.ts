/**
 * Time in the user's timezone. "Today" is always the user's today (from
 * /v1/me), never the browser's and never UTC (Brain docs/01-domain.md).
 * A day is identified by a key "YYYY-MM-DD" in that zone.
 */
export type DayKey = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }

export function wallClock(at: Date, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(at: Date, tz: string): DayKey {
  const w = wallClock(at, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

function keyToUTC(k: DayKey): number {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** Whole calendar days from a to b (b later is positive). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((keyToUTC(b) - keyToUTC(a)) / 864e5);
}

export function addDaysToKey(k: DayKey, n: number): DayKey {
  const t = new Date(keyToUTC(k) + n * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, for a day key. Calendar maths, zone-free. */
export function weekdayOfKey(k: DayKey): number {
  return new Date(keyToUTC(k)).getUTCDay();
}

export function dayOfMonthOfKey(k: DayKey): number {
  return Number(k.slice(8, 10));
}

export function mondayOfKey(k: DayKey): DayKey {
  return addDaysToKey(k, -((weekdayOfKey(k) + 6) % 7));
}

/** Offset of a zone from UTC at an instant, in ms (IST is +19,800,000). */
export function zoneOffsetMs(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  const asUTC = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads the given time. */
export function zonedToInstant(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - zoneOffsetMs(new Date(guess), tz);
  // Second pass settles DST edges, where the first guess used the wrong offset.
  t = guess - zoneOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** "2026-11-24T09:30" in the user's zone, for <input type="datetime-local">. */
export function toLocalInput(iso: string, tz: string): string {
  const w = wallClock(new Date(iso), tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

export function fromLocalInput(v: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return zonedToInstant(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz).toISOString();
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const D3 = DAYS.map((d) => d.slice(0, 3));
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const M3 = MONTHS.map((m) => m.slice(0, 3));

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** "Tuesday, 24 November" for a day key. */
export function longDay(k: DayKey): string {
  return `${DAYS[weekdayOfKey(k)]}, ${dayOfMonthOfKey(k)} ${MONTHS[Number(k.slice(5, 7)) - 1]}`;
}

/** "Tue 24 Nov". */
export function shortDay(k: DayKey): string {
  return `${D3[weekdayOfKey(k)]} ${dayOfMonthOfKey(k)} ${M3[Number(k.slice(5, 7)) - 1]}`;
}

/** "due today", "overdue by 2 days", "due tomorrow", "due in 5 days", "due Tue 8 Dec". */
export function dueLabel(dueIso: string, now: Date, tz: string): { text: string; urgent: boolean } {
  const n = daysBetween(dayKey(now, tz), dayKey(new Date(dueIso), tz));
  if (n < 0) return { text: `overdue by ${-n} day${n === -1 ? '' : 's'}`, urgent: true };
  if (n === 0) return { text: 'due today', urgent: true };
  if (n === 1) return { text: 'due tomorrow', urgent: true };
  if (n <= 14) return { text: `due in ${n} days`, urgent: false };
  return { text: `due ${shortDay(dayKey(new Date(dueIso), tz))}`, urgent: false };
}

export function relativeDay(k: DayKey, today: DayKey): string {
  const n = daysBetween(today, k);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
