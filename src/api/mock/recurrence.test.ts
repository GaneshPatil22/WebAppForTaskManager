import { describe, expect, it } from 'vitest';
import type { Rule } from '../types';
import { days, matches, next, ruleText, scheduledOn, streak, validRule, type Template } from './recurrence';

const t = (rule: Rule, o: Partial<Template> = {}): Template => ({ id: 'A', kind: 'habit', rule, minutes: 10, startOn: '2026-01-01', paused: false, ...o });

describe('recurrence (port of Brain Commitment.swift)', () => {
  it('clamps the 31st to the last day of shorter months, never skipping', () => {
    const rent = t({ kind: 'monthlyOnDay', day: 31 });
    expect(days(rent, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(matches({ kind: 'monthlyOnDay', day: 29 }, '2028-02-29')).toBe(true);
  });

  it('finds the first Saturday, including when the month opens on one', () => {
    const review = { kind: 'monthlyOnNthWeekday', n: 1, weekday: 'saturday' } as const;
    expect(matches(review, '2026-08-01')).toBe(true); // 1 Aug 2026 is a Saturday
    expect(matches(review, '2026-08-08')).toBe(false);
    expect(days(t(review), '2026-11-01', '2026-11-30')).toEqual(['2026-11-07']);
  });

  it('quarterly falls only in January, April, July and October', () => {
    const q = t({ kind: 'quarterlyOnNthWeekday', n: 1, weekday: 'saturday' });
    expect(days(q, '2026-01-01', '2026-12-31')).toEqual(['2026-01-03', '2026-04-04', '2026-07-04', '2026-10-03']);
  });

  it('skips months without a fifth weekday', () => {
    expect(days(t({ kind: 'monthlyOnNthWeekday', n: 5, weekday: 'friday' }), '2026-01-01', '2026-03-31')).toEqual(['2026-01-30']);
  });

  it('respects the active window and pause', () => {
    expect(days(t({ kind: 'daily' }, { startOn: '2026-03-02', endOn: '2026-03-03' }), '2026-03-01', '2026-03-05')).toEqual(['2026-03-02', '2026-03-03']);
    expect(days(t({ kind: 'daily' }, { paused: true }), '2026-03-01', '2026-03-05')).toEqual([]);
    expect(next(t({ kind: 'weeklyOn', weekday: 'sunday' }), '2026-11-24')).toBe('2026-11-29');
  });

  it('a streak counts back from today; today not done yet does not break it', () => {
    const d = t({ kind: 'daily' });
    expect(streak(d, new Set(['2026-11-22', '2026-11-23']), '2026-11-24')).toBe(2);
    expect(streak(d, new Set(['2026-11-22', '2026-11-23', '2026-11-24']), '2026-11-24')).toBe(3);
    expect(streak(d, new Set(['2026-11-22']), '2026-11-24')).toBe(0);
  });

  it('orders a day: payments, rituals, blocks, habits; then id', () => {
    const all = [
      t({ kind: 'daily' }, { id: 'H', kind: 'habit' }),
      t({ kind: 'daily' }, { id: 'B', kind: 'block' }),
      t({ kind: 'daily' }, { id: 'P', kind: 'payment' }),
      t({ kind: 'daily' }, { id: 'R', kind: 'ritual' }),
    ];
    expect(scheduledOn(all, '2026-11-24').map((c) => c.id)).toEqual(['P', 'R', 'B', 'H']);
  });

  it('words rules like Brain, and refuses fields a shape does not use', () => {
    expect(ruleText({ kind: 'monthlyOnDay', day: 4 })).toBe('Monthly on the 4th');
    expect(ruleText({ kind: 'monthlyOnNthWeekday', n: 1, weekday: 'saturday' })).toBe('Monthly on the 1st Saturday');
    expect(validRule({ kind: 'daily', weekday: 'monday' })).toBe(false);
    expect(validRule({ kind: 'monthlyOnDay', day: 32 })).toBe(false);
    expect(validRule({ kind: 'weeklyOn', weekday: 'friday' })).toBe(true);
  });
});
