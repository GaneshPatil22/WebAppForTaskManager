import { describe, expect, it } from 'vitest';
import { endOfDayIso } from './planned';

describe('endOfDayIso', () => {
  it('is the last second of that day in the user’s zone', () => {
    expect(endOfDayIso('2026-11-25', 'Asia/Kolkata')).toBe('2026-11-25T18:29:59.000Z');
    expect(endOfDayIso('2026-11-25', 'UTC')).toBe('2026-11-25T23:59:59.000Z');
  });
});
