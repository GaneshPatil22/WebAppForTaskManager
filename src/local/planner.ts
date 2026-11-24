import type { DayKey } from '../domain/time';
import type { BucketId } from '../domain/board';
import { createLocalStore } from './store';

/**
 * Device-only arrangement for the optional 1-3-5 board: a manual order and
 * moves between its groups, today only. A view choice: it never changes an
 * item's effort and never reaches Brain's ranking. Nothing else in the app
 * reads this.
 */
export interface BoardArrangement {
  order: Record<DayKey, string[]>;
  moved: Record<DayKey, Record<string, BucketId>>;
}

export const boardStore = createLocalStore<BoardArrangement>('brain-local-board-v2', () => ({ order: {}, moved: {} }));

export const board = {
  /** Saves a rearrangement; `to` also moves the item into another group. Today only. */
  applyMove(day: DayKey, id: string, order: string[], to?: BucketId) {
    boardStore.set((s) => ({
      order: { [day]: order },
      moved: { [day]: { ...(s.moved[day] ?? {}), ...(to ? { [id]: to } : {}) } },
    }));
  },
  /** Back to Brain's order and the effort-based groups. */
  reset() {
    boardStore.set({ order: {}, moved: {} });
  },
};
