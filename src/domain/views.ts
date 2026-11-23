import { createLocalStore } from '../local/store';

/**
 * The view registry (Brain backlog B-06). Views are windows onto the same
 * data, and the user decides which exist. Navigation and settings are built
 * from this list; nothing else hard-codes which views there are.
 *
 * `live` is backed by the Brain server. `in-progress` works on this device
 * only, because the server does not model it yet, and says so on screen.
 */
export type ViewStatus = 'live' | 'in-progress';

export type ViewId = 'today' | 'inbox' | 'items' | 'goals' | 'week' | 'repeats' | 'progress';
export type SectionId = 'board' | 'timer' | 'quickWins' | 'blocked' | 'comingUp' | 'suggestions' | 'questions';

export interface ViewDef {
  id: ViewId;
  path: string;
  title: string;
  icon: IconName;
  status: ViewStatus;
  description: string;
  /** Core views cannot be switched off. */
  core?: boolean;
}

export interface SectionDef {
  id: SectionId;
  title: string;
  status: ViewStatus;
  description: string;
}

export type IconName = 'today' | 'inbox' | 'list' | 'goal' | 'week' | 'repeat' | 'progress' | 'settings';

export const VIEWS: ViewDef[] = [
  { id: 'today', path: '/', title: 'Today', icon: 'today', status: 'live', core: true, description: 'The one thing to do next, and what is behind it.' },
  { id: 'inbox', path: '/inbox', title: 'Inbox', icon: 'inbox', status: 'live', core: true, description: 'Everything you dumped, as Brain sorts it.' },
  { id: 'items', path: '/items', title: 'All items', icon: 'list', status: 'live', description: 'Every item, open or closed. Edit anything Brain decided.' },
  { id: 'goals', path: '/goals', title: 'Goals', icon: 'goal', status: 'live', description: 'Outcomes your items serve. Only you create them.' },
  { id: 'week', path: '/week', title: 'Week', icon: 'week', status: 'in-progress', description: 'Due dates and repeats across the week, plus days you plan.' },
  { id: 'repeats', path: '/repeats', title: 'Repeats', icon: 'repeat', status: 'in-progress', description: 'Daily, weekly and monthly things that come back.' },
  { id: 'progress', path: '/progress', title: 'Progress', icon: 'progress', status: 'in-progress', description: 'Focus time and habit streaks.' },
];

export const TODAY_SECTIONS: SectionDef[] = [
  { id: 'board', title: '1-3-5 board', status: 'in-progress', description: 'Today grouped as one big, three medium, five quick. Otherwise a plain ranked list.' },
  { id: 'timer', title: 'Focus timer', status: 'in-progress', description: 'Pomodoro and quick timers.' },
  { id: 'questions', title: 'Questions from Brain', status: 'live', description: 'One-tap answers instead of guesses.' },
  { id: 'suggestions', title: 'Link suggestions', status: 'live', description: 'Duplicates and dependencies Brain noticed.' },
  { id: 'quickWins', title: 'Quick wins', status: 'live', description: 'Cheap and worthwhile.' },
  { id: 'blocked', title: 'Blocked', status: 'live', description: 'Waiting on something else first.' },
  { id: 'comingUp', title: 'Coming up', status: 'in-progress', description: 'Weekly and monthly repeats ahead.' },
];

export type Prefs = Partial<Record<ViewId | SectionId, boolean>>;

export const viewPrefsStore = createLocalStore<Prefs>('brain-view-prefs-v1', () => ({}));

export function isOn(prefs: Prefs, id: ViewId | SectionId): boolean {
  const v = VIEWS.find((x) => x.id === id);
  if (v?.core) return true;
  return prefs[id] ?? true;
}

export function setOn(id: ViewId | SectionId, on: boolean) {
  viewPrefsStore.set((p) => ({ ...p, [id]: on }));
}
