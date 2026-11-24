import { createLocalStore } from '../local/store';

/**
 * Display choices, kept on this device. None of them changes what Brain
 * computes; they only choose how Today shows it.
 *
 * - `board`: show today's candidates as the 1-3-5 board instead of a ranked
 *   list. Off by default and optional: nothing else depends on it.
 * - `timer`: the focus/quick timer in the top bar.
 */
export interface Prefs {
  board: boolean;
  timer: boolean;
}

export const prefsStore = createLocalStore<Prefs>('brain-prefs-v2', () => ({ board: false, timer: true }));

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefsStore.set((p) => ({ ...p, [k]: v }));
}
