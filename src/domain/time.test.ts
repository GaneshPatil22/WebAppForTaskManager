import { describe, expect, it } from 'vitest';
import { dayKey, dueLabel, fromLocalInput, toLocalInput, zonedToInstant, mondayOfKey, daysBetween } from './time';

describe('today is the user’s today', () => {
  it('23:30 UTC is already tomorrow in Kolkata', () => {
    const t = new Date('2026-11-23T23:30:00Z');
    expect(dayKey(t, 'UTC')).toBe('2026-11-23');
    expect(dayKey(t, 'Asia/Kolkata')).toBe('2026-11-24');
  });
  it('due labels count calendar days in the user zone', () => {
    const now = zonedToInstant(2026, 11, 23, 23, 0, 'Asia/Kolkata');
    expect(dueLabel(zonedToInstant(2026, 11, 24, 0, 30, 'Asia/Kolkata').toISOString(), now, 'Asia/Kolkata').text).toBe('due tomorrow');
    expect(dueLabel(zonedToInstant(2026, 11, 21, 9, 0, 'Asia/Kolkata').toISOString(), now, 'Asia/Kolkata').text).toBe('overdue by 2 days');
  });
  it('datetime-local round-trips through the user zone, across DST', () => {
    for (const tz of ['Asia/Kolkata', 'America/Los_Angeles', 'Europe/London']) {
      for (const v of ['2026-11-01T01:30', '2026-07-15T09:00', '2026-12-31T23:59']) {
        expect(toLocalInput(fromLocalInput(v, tz)!, tz)).toBe(v);
      }
    }
  });
  it('a wall time just after a DST change gets the new offset', () => {
    // 05:00 on 8 Mar 2026 in Los Angeles is PDT (UTC-7), but 05:00 UTC that
    // morning is still PST. A one-pass conversion lands an hour late.
    expect(zonedToInstant(2026, 3, 8, 5, 0, 'America/Los_Angeles').toISOString()).toBe('2026-03-08T12:00:00.000Z');
  });
  it('weeks start on Monday', () => {
    expect(mondayOfKey('2026-11-29')).toBe('2026-11-23');
    expect(daysBetween('2026-11-23', '2026-12-01')).toBe(8);
  });
});
