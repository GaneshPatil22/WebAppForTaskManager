import type { Category, DecidedBy, Effort, EdgeKind, ItemType } from '../api/types';

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

/** Who decided a value, in the user's words. "Suggested" vs "you said". */
export function decidedByLabel(d: DecidedBy): { text: string; suggested: boolean } {
  switch (d) {
    case 'user': return { text: 'You set this', suggested: false };
    case 't3': return { text: 'You answered', suggested: false };
    case 't0': return { text: 'Suggested from your words', suggested: true };
    case 't1': return { text: 'Suggested by Brain', suggested: true };
    case 't2': return { text: 'Suggested by AI', suggested: true };
  }
}

/** Confidence in words. Numbers on screen invite false precision. */
export function confidenceWord(c: number): 'Likely' | 'Maybe' | 'Unsure' {
  if (c >= 0.8) return 'Likely';
  if (c >= 0.5) return 'Maybe';
  return 'Unsure';
}
