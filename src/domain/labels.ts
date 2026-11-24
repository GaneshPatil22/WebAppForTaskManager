import type { Category, CommitmentKind, DecidedBy, Effort, EdgeKind, ItemType, RuleKind, Weekday } from '../api/types';

/** Bucket minutes, from Brain docs/01-domain.md. `unknown` scores as medium. */
export const EFFORT_MINUTES: Record<Effort, number> = {
  tiny: 5, small: 20, medium: 60, large: 240, xlarge: 960, unknown: 60,
};

export const EFFORT_LABEL: Record<Effort, string> = {
  tiny: 'about 5 min',
  small: 'about 20 min',
  medium: 'about an hour',
  large: 'about half a day',
  xlarge: 'several days',
  unknown: 'effort unknown',
};

export const EFFORT_SHORT: Record<Effort, string> = {
  tiny: 'Tiny · 5 min', small: 'Small · 20 min', medium: 'Medium · 1 h',
  large: 'Large · half day', xlarge: 'X-large · days', unknown: 'Unknown',
};

/** The sizes a person can pick. `unknown` is Brain's, never a choice. */
export const SIZES: readonly Effort[] = ['tiny', 'small', 'medium', 'large', 'xlarge'];
/** A size, short enough for a chip on a row. */
export const SIZE_CHIP: Record<Effort, string> = {
  tiny: '5 min', small: '20 min', medium: '1 h', large: 'half day', xlarge: 'days', unknown: 'unknown',
};

export const TYPE_LABEL: Record<ItemType, string> = {
  task: 'Task', idea: 'Idea', note: 'Note', reminder: 'Reminder', link: 'Link',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  paperwork: 'Paperwork', errands: 'Errands', communication: 'Calls & messages', planning: 'Planning',
  deepWork: 'Deep work', chores: 'Chores', money: 'Money', learning: 'Learning', health: 'Health',
};

export const EDGE_PHRASE: Record<EdgeKind, string> = {
  blocks: 'blocks', relates: 'relates to', duplicate: 'is a duplicate of', serves: 'serves',
};

/** Who decided a value, in the user's words. Brain's guess vs "you said". */
export function decidedByLabel(d: DecidedBy): { text: string; long: string; suggested: boolean } {
  switch (d) {
    case 'user': return { text: 'You set', long: 'You set this.', suggested: false };
    case 't3': return { text: 'You answered', long: 'You answered Brain’s question.', suggested: false };
    case 't0': return { text: 'Brain’s guess', long: 'Read from your words by rules. A guess until you change it.', suggested: true };
    case 't1': return { text: 'Brain’s guess', long: 'Brain’s own model guessed this.', suggested: true };
    case 't2': return { text: 'AI guess', long: 'A general AI model guessed this.', suggested: true };
  }
}

export const KIND_LABEL: Record<CommitmentKind, string> = { habit: 'Habit', ritual: 'Ritual', payment: 'Payment', block: 'Time block' };
export const KIND_HINT: Record<CommitmentKind, string> = {
  habit: 'Something you do, with a streak. Read 10 pages, move body.',
  ritual: 'A review or routine that produces something. Sunday review.',
  payment: 'A dated reminder. Put any amount in the note; it is never added up.',
  block: 'Time set aside, not a task. Friday 3-hour office block.',
};
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};
export const RULE_LABEL: Record<RuleKind, string> = {
  daily: 'Every day', weeklyOn: 'Every week on…', monthlyOnDay: 'Every month on day…',
  monthlyOnNthWeekday: 'Every month on the nth…', quarterlyOnNthWeekday: 'Every quarter on the nth…',
};

/** Confidence in words. Numbers on screen invite false precision. */
export function confidenceWord(c: number): 'Likely' | 'Maybe' | 'Unsure' {
  if (c >= 0.8) return 'Likely';
  if (c >= 0.5) return 'Maybe';
  return 'Unsure';
}
