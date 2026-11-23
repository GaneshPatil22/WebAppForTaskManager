import { ulid } from 'ulid';
import { addDaysToKey, dayOfMonthOfKey, weekdayOfKey, type DayKey } from '../domain/time';
import { createLocalStore } from './store';

/**
 * IN PROGRESS: recurring items (Brain backlog B-05) live on this device
 * until the server models them. The open question there — one moving item
 * or a series of instances — is why they are not items yet.
 */
export type RepeatKind = 'daily' | 'weekly' | 'monthly';

export interface Repeat {
  id: string;
  title: string;
  kind: RepeatKind;
  /** weekly: 0 = Sunday … 6 = Saturday */
  weekday?: number;
  /** monthly: 1–31. Months without that day use their last day. */
  monthDay?: number;
  minutes: number;
  paused: boolean;
  createdOn: DayKey;
  doneOn: DayKey[];
}

export const repeatsStore = createLocalStore<Repeat[]>('brain-local-repeats-v1', () => []);

function lastDayOfMonth(k: DayKey): number {
  const [y, m] = k.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function isDueOn(r: Repeat, k: DayKey): boolean {
  if (r.paused) return false;
  if (r.kind === 'daily') return true;
  if (r.kind === 'weekly') return weekdayOfKey(k) === r.weekday;
  const want = Math.min(r.monthDay ?? 1, lastDayOfMonth(k));
  return dayOfMonthOfKey(k) === want;
}

export function nextDueOn(r: Repeat, from: DayKey, horizon = 400): DayKey | null {
  if (r.paused) return null;
  for (let i = 0; i < horizon; i++) {
    const k = addDaysToKey(from, i);
    if (isDueOn({ ...r, paused: false }, k)) return k;
  }
  return null;
}

/**
 * Consecutive occurrences done, counting back from the latest one. Today's
 * occurrence, if not yet done, does not break the streak: the day isn't over.
 */
export function streak(r: Repeat, today: DayKey): number {
  const done = new Set(r.doneOn);
  let n = 0;
  let k = today;
  const unpaused = { ...r, paused: false };
  for (let i = 0; i < 800; i++, k = addDaysToKey(k, -1)) {
    if (k < r.createdOn && !done.has(k)) break;
    if (!isDueOn(unpaused, k)) continue;
    if (done.has(k)) n++;
    else if (k === today) continue;
    else break;
  }
  return n;
}

export function ruleText(r: Repeat): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (r.kind === 'daily') return 'Every day';
  if (r.kind === 'weekly') return `Every ${days[r.weekday ?? 0]}`;
  const d = r.monthDay ?? 1;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = d % 100;
  return `Monthly on the ${d}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const repeats = {
  add(input: Omit<Repeat, 'id' | 'paused' | 'doneOn' | 'createdOn'>, today: DayKey) {
    repeatsStore.set((l) => [...l, { ...input, id: ulid(), paused: false, doneOn: [], createdOn: today }]);
  },
  toggleDone(id: string, day: DayKey) {
    repeatsStore.set((l) => l.map((r) => (r.id !== id ? r : {
      ...r, doneOn: r.doneOn.includes(day) ? r.doneOn.filter((d) => d !== day) : [...r.doneOn, day].sort(),
    })));
  },
  togglePause(id: string) {
    repeatsStore.set((l) => l.map((r) => (r.id === id ? { ...r, paused: !r.paused } : r)));
  },
  remove(id: string) {
    repeatsStore.set((l) => l.filter((r) => r.id !== id));
  },
};

/** A few to start with, so the screen isn't empty on first visit. */
export function seedRepeats(today: DayKey) {
  if (repeatsStore.get().length) return;
  const back = (n: number) => Array.from({ length: n }, (_, i) => addDaysToKey(today, -(i + 1)));
  const since = addDaysToKey(today, -60);
  repeatsStore.set([
    { id: ulid(), title: 'Read 10 pages of a book', kind: 'daily', minutes: 15, paused: false, createdOn: since, doneOn: back(12).filter((_, i) => i !== 13).sort() },
    { id: ulid(), title: 'Ukulele practice', kind: 'daily', minutes: 15, paused: false, createdOn: since, doneOn: back(6).sort() },
    { id: ulid(), title: 'Plan the week', kind: 'weekly', weekday: 0, minutes: 15, paused: false, createdOn: since, doneOn: [] },
    { id: ulid(), title: 'Review the week', kind: 'weekly', weekday: 5, minutes: 15, paused: false, createdOn: since, doneOn: [] },
    { id: ulid(), title: 'SIP ₹5,000', kind: 'monthly', monthDay: 15, minutes: 5, paused: false, createdOn: since, doneOn: [] },
    { id: ulid(), title: 'Pay rent', kind: 'monthly', monthDay: 5, minutes: 5, paused: false, createdOn: since, doneOn: [] },
  ]);
}
