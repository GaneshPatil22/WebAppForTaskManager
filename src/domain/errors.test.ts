import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { errorText } from '../ui/components';

describe('errorText', () => {
  it('says what a planner refusal means, not the raw server message', () => {
    expect(errorText(new ApiError(400, 'in_future', 'that day has not come yet'))).toBe('That day hasn’t come yet.');
    expect(errorText(new ApiError(409, 'already_answered', 'x'))).toMatch(/edit the item/);
  });
  it('falls back to the server’s message for a code it doesn’t know', () => {
    expect(errorText(new ApiError(400, 'something_new', 'a new rule'))).toBe('a new rule');
  });
  it('never blames the user for an unreachable server', () => {
    expect(errorText(new ApiError(503, 'unavailable', 'down'))).toMatch(/Can’t reach Brain/);
  });
});
