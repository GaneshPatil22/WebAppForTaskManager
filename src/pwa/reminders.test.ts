import { describe, expect, it } from 'vitest';
import type { Commitment, Occurrence } from '../api/types';
import { buildReminders, dueReminders, type ReminderPrefs } from './reminders';

const c = (id: string, title: string, kind: Commitment['kind'], rule: Commitment['rule'], note?: string): Commitment => ({
  id, title, kind, rule, ruleText: '', minutes: 10, startOn: '2026-01-01', paused: false, streak: 0,
  createdAt: '', updatedAt: '', ...(note ? { note } : {}),
});
const prefs: ReminderPrefs = { enabled: true, morningAt: '08:00', paymentEve: true, eveningAt: '20:00' };
const read = c('A', 'Read 10 pages', 'habit', { kind: 'daily' });
const rent = c('B', 'Pay rent', 'payment', { kind: 'monthlyOnDay', day: 4 }, '22k');
const review = c('C', 'Weekly review', 'ritual', { kind: 'weeklyOn', weekday: 'sunday' });

describe('buildReminders', () => {
  const occ: Occurrence[] = [
    { commitmentId: 'A', day: '2026-12-03' },
    { commitmentId: 'A', day: '2026-12-04' },
    { commitmentId: 'B', day: '2026-12-04' },
  ];

  it('names payments with their note as written, and counts daily habits', () => {
    const r = buildReminders('2026-12-03', occ, [read, rent, review], prefs);
    const morning = r.find((x) => x.id === 'morning:2026-12-04')!;
    expect(morning.title).toBe('Today: Pay rent (22k)');
    expect(morning.body).toBe('Pay rent (22k) · 1 daily habit');
  });

  it('warns the evening before a payment', () => {
    const r = buildReminders('2026-12-03', occ, [read, rent], prefs);
    expect(r.find((x) => x.id === 'eve:2026-12-04')).toMatchObject({ day: '2026-12-03', at: '20:00', title: 'Tomorrow: Pay rent (22k)' });
  });

  it('places a moved occurrence on its new day and leaves done ones out', () => {
    const r = buildReminders('2026-12-03', [
      { commitmentId: 'C', day: '2026-12-06', state: 'moved', movedTo: '2026-12-07' },
      { commitmentId: 'A', day: '2026-12-03', state: 'done' },
    ], [read, review], prefs);
    expect(r.map((x) => x.id)).toEqual(['morning:2026-12-07']);
  });
});

describe('dueReminders', () => {
  const digest = {
    tz: 'Asia/Kolkata', builtAt: '',
    reminders: [
      { id: 'm', day: '2026-12-04', at: '08:00', title: '', body: '', url: '/' },
      { id: 'e', day: '2026-12-04', at: '20:00', title: '', body: '', url: '/' },
    ],
  };
  it('fires at or after the time in the user’s zone, once', () => {
    const nineIST = new Date('2026-12-04T03:30:00Z');
    expect(dueReminders(digest, nineIST, new Set()).map((r) => r.id)).toEqual(['m']);
    expect(dueReminders(digest, nineIST, new Set(['m']))).toEqual([]);
  });
});
