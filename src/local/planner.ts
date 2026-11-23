import type { DayKey } from '../domain/time';
import { createLocalStore } from './store';

/**
 * IN PROGRESS: personal planning choices the server has no field for yet.
 * - "Not now" hides an item from today's board (today only).
 * - A planned day puts an item on a day of the week view.
 * - A manual order lets you rearrange today's board.
 * None of these change Brain's ranking. They are the kind of feedback the
 * daily review (backlog B-06d) would eventually send back as training signal.
 */
export interface PlannerState {
  notNow: Record<DayKey, string[]>;
  plannedDay: Record<string, DayKey>;
  order: Record<DayKey, string[]>;
}

export const plannerStore = createLocalStore<PlannerState>('brain-local-planner-v1', () => ({ notNow: {}, plannedDay: {}, order: {} }));

export const planner = {
  notNow(id: string, day: DayKey) {
    plannerStore.set((s) => ({ ...s, notNow: { [day]: [...(s.notNow[day] ?? []), id] } }));
  },
  undoNotNow(id: string, day: DayKey) {
    plannerStore.set((s) => ({ ...s, notNow: { ...s.notNow, [day]: (s.notNow[day] ?? []).filter((x) => x !== id) } }));
  },
  planOn(id: string, day: DayKey | null) {
    plannerStore.set((s) => {
      const plannedDay = { ...s.plannedDay };
      if (day) plannedDay[id] = day; else delete plannedDay[id];
      return { ...s, plannedDay };
    });
  },
  setOrder(day: DayKey, ids: string[]) {
    plannerStore.set((s) => ({ ...s, order: { [day]: ids } }));
  },
  clearOrder(day: DayKey) {
    plannerStore.set((s) => ({ ...s, order: { ...s.order, [day]: [] } }));
  },
};
