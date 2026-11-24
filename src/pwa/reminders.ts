/**
 * Local reminders for commitments and dated payments.
 *
 * Brain has no push server, so reminders come from this device. The page
 * turns the server's occurrences for the next week into a small list of
 * reminders and stores it in IndexedDB. Both the page (while open) and the
 * service worker (Periodic Background Sync, where the browser allows it)
 * fire whatever is due and not yet shown. Nothing here decides what is on
 * a day: that comes from /v1/occurrences.
 *
 * Kept in step with the reading code in `src/pwa/swSource.ts` by hand: same
 * database, store, keys and shapes.
 */
import type { Commitment, Occurrence } from '../api/types';
import { createLocalStore } from '../local/store';
import { addDaysToKey, longDay, type DayKey } from '../domain/time';

export interface ReminderPrefs {
  enabled: boolean;
  /** "HH:MM" in the user's timezone. */
  morningAt: string;
  /** A note the evening before each payment. */
  paymentEve: boolean;
  eveningAt: string;
}

export const reminderPrefsStore = createLocalStore<ReminderPrefs>('brain-reminders-v1', () => ({
  enabled: false, morningAt: '08:00', paymentEve: true, eveningAt: '20:00',
}));

export interface Reminder {
  /** Unique per reminder and day; also the notification tag. */
  id: string;
  /** The day it fires, in the user's timezone. */
  day: DayKey;
  /** "HH:MM" in the user's timezone. */
  at: string;
  title: string;
  body: string;
  url: string;
}

export interface Digest { tz: string; builtAt: string; reminders: Reminder[] }

/** How many days ahead reminders are prepared, so they still fire if the app isn't opened. */
export const HORIZON_DAYS = 7;

/**
 * Builds the reminders for `today` and the days after it. Pure: occurrences
 * are the server's, already expanded from the rules. Order within a day is
 * the server's. Amounts in notes are shown as written, never added.
 */
export function buildReminders(today: DayKey, occurrences: Occurrence[], commitments: Commitment[], prefs: ReminderPrefs): Reminder[] {
  const byId = new Map(commitments.map((c) => [c.id, c]));
  const onDay = new Map<DayKey, Commitment[]>();
  for (const o of occurrences) {
    if (o.state === 'done' || o.state === 'skipped') continue;
    const place = o.movedTo ?? o.day;
    if (o.state === 'moved' && place === o.day) continue;
    const c = byId.get(o.commitmentId);
    if (!c) continue;
    onDay.set(place, [...(onDay.get(place) ?? []), c]);
  }
  const label = (c: Commitment) => (c.note ? `${c.title} (${c.note})` : c.title);
  const out: Reminder[] = [];
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const day = addDaysToKey(today, i);
    const list = onDay.get(day) ?? [];
    if (list.length) {
      const dated = list.filter((c) => c.rule.kind !== 'daily');
      const daily = list.length - dated.length;
      const parts = [...dated.map(label), ...(daily ? [`${daily} daily habit${daily === 1 ? '' : 's'}`] : [])];
      out.push({
        id: `morning:${day}`, day, at: prefs.morningAt,
        title: dated.some((c) => c.kind === 'payment') ? `Today: ${dated.filter((c) => c.kind === 'payment').map(label).join(', ')}` : `Today: ${list.length} commitment${list.length === 1 ? '' : 's'}`,
        body: parts.join(' · '),
        url: '/',
      });
    }
    if (prefs.paymentEve) {
      const tomorrow = addDaysToKey(day, 1);
      const pays = (onDay.get(tomorrow) ?? []).filter((c) => c.kind === 'payment');
      if (pays.length) {
        out.push({
          id: `eve:${tomorrow}`, day, at: prefs.eveningAt,
          title: `Tomorrow: ${pays.map(label).join(', ')}`,
          body: `Due ${longDay(tomorrow)}.`,
          url: '/week',
        });
      }
    }
  }
  return out;
}

/** The reminders that should show now: today's, at or after their time, not yet shown. */
export function dueReminders(d: Digest, now: Date, shown: ReadonlySet<string>): Reminder[] {
  const { day, hhmm } = wallNow(now, d.tz);
  return d.reminders.filter((r) => r.day === day && r.at <= hhmm && !shown.has(r.id));
}

export function wallNow(now: Date, tz: string): { day: DayKey; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

// ---- IndexedDB, shared with the service worker ----
const DB = 'brain-reminders';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close()) as Promise<T>;
}

export const reminderDb = {
  saveDigest: (d: Digest | null) => tx<unknown>('readwrite', (s) => (d ? s.put(d, 'digest') : s.delete('digest')) as IDBRequest<unknown>),
  digest: () => tx<Digest | undefined>('readonly', (s) => s.get('digest') as IDBRequest<Digest | undefined>),
  shown: async () => new Set<string>((await tx<string[] | undefined>('readonly', (s) => s.get('shown') as IDBRequest<string[] | undefined>)) ?? []),
  markShown: async (ids: string[]) => {
    const prev = [...(await reminderDb.shown())];
    // Keep a bounded history: a couple of weeks of ids is plenty.
    await tx('readwrite', (s) => s.put([...prev, ...ids].slice(-200), 'shown'));
  },
};
