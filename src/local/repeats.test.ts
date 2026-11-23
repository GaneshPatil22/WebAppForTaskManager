import { describe, expect, it } from 'vitest';
import { isDueOn, nextDueOn, streak, type Repeat } from './repeats';

const base: Repeat = { id: 'r', title: 't', kind: 'daily', minutes: 5, paused: false, createdOn: '2026-10-01', doneOn: [] };

describe('repeats', () => {
  it('monthly on the 31st falls on the last day of shorter months', () => {
    const r = { ...base, kind: 'monthly' as const, monthDay: 31 };
    expect(isDueOn(r, '2026-11-30')).toBe(true);
    expect(isDueOn(r, '2027-02-28')).toBe(true);
    expect(isDueOn(r, '2026-12-30')).toBe(false);
  });
  it('weekly lands on its weekday', () => {
    expect(nextDueOn({ ...base, kind: 'weekly', weekday: 5 }, '2026-11-24')).toBe('2026-11-27');
  });
  it('streak counts back and is not broken by today being undone', () => {
    const r = { ...base, doneOn: ['2026-11-21', '2026-11-22', '2026-11-23'] };
    expect(streak(r, '2026-11-24')).toBe(3);
    expect(streak({ ...r, doneOn: [...r.doneOn, '2026-11-24'] }, '2026-11-24')).toBe(4);
    expect(streak({ ...r, doneOn: ['2026-11-21', '2026-11-23'] }, '2026-11-24')).toBe(1);
  });
  it('a paused repeat is never due', () => {
    expect(isDueOn({ ...base, paused: true }, '2026-11-24')).toBe(false);
  });
});
