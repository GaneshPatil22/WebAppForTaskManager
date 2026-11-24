/**
 * What each server error code means, in words a person can act on. The
 * codes and their conditions come from Server/Sources/App (APIHandler,
 * APIHandler+Planner, Validation). A code not listed here falls back to
 * the server's own message.
 */
export const ERROR_TEXT: Record<string, string> = {
  // planner
  not_scheduled: 'That commitment doesn’t fall on that day.',
  in_future: 'That day hasn’t come yet.',
  invalid_move: 'Pick a different day to move it to.',
  invalid_window: 'The end date can’t be before the start date.',
  invalid_rule: 'That repeat pattern isn’t complete. Check the days you picked.',
  invalid_range: 'That range is too long. Brain looks at up to 92 days at a time.',
  day_out_of_range: 'The big task can only be set for yesterday, today or tomorrow.',
  item_not_open: 'That item is already finished, so it can’t be the big task.',
  invalid_rollup: 'A month goal can only roll up into a goal for the quarter that contains that month.',
  conflicting_clear: 'A field was both changed and cleared. Try again.',
  // questions (T3)
  not_an_option: 'Pick one of the answers offered.',
  already_answered: 'You already answered this one. To change it, edit the item.',
  // links, goals, account
  duplicate_edge: 'These two are already linked that way.',
  cycle: 'That would make a loop: each would wait on the other.',
  self_link: 'An item can’t be linked to itself.',
  invalid_period: 'A period is a month (2026-11) or a quarter (2026-Q4).',
  invalid_timezone: 'That timezone isn’t one Brain knows.',
};

export function textForCode(code: string): string | undefined {
  return ERROR_TEXT[code];
}
