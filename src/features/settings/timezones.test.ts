import { describe, expect, it } from 'vitest';
import { timezoneOptions } from './timezones';

describe('timezoneOptions', () => {
  const v8 = () => ['Africa/Abidjan', 'Asia/Calcutta', 'Europe/London'];

  it('includes the user’s zone when the browser leaves it out (Asia/Kolkata on V8)', () => {
    const opts = timezoneOptions('Asia/Kolkata', v8);
    expect(opts).toContain('Asia/Kolkata');
    expect(opts[0]).toBe('Africa/Abidjan'); // still sorted
  });

  it('does not duplicate a zone that is already listed', () => {
    expect(timezoneOptions('Europe/London', v8)).toEqual(v8());
  });

  it('works before /v1/me has answered', () => {
    expect(timezoneOptions(undefined, v8)).toEqual(v8());
  });
});
