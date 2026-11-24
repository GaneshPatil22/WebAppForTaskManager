import { createLocalStore } from './store';
import { addDaysToKey, daysBetween, zonedToInstant, type DayKey } from '../domain/time';

/**
 * Things added from "Plan tomorrow", waiting to become items.
 *
 * There is no "create item" endpoint: everything enters Brain as a capture,
 * and Brain turns it into an item a moment later (or later still, if the
 * capture waited offline in the outbox). So the day you chose is kept here,
 * by capture id, and the shell sets it as the item's due date, as your
 * decision, once the item exists. Kept until then, so a reload or a closed
 * tab loses nothing.
 *
 * Carrying over needs nothing extra: an open item whose day has passed stays
 * open and shows as overdue, with the day you planned it for, and Brain
 * keeps ranking it.
 */
export interface PlannedEntry { captureId: string; day: DayKey; text: string; addedOn: DayKey }

export const plannedStore = createLocalStore<PlannedEntry[]>('brain-planned-v1', () => []);

/** A capture that never became an item within two weeks is not waited for. */
const GIVE_UP_DAYS = 14;

export const planned = {
  add(e: PlannedEntry) { plannedStore.set((all) => [...all.filter((x) => x.captureId !== e.captureId), e]); },
  done(captureId: string) { plannedStore.set((all) => all.filter((x) => x.captureId !== captureId)); },
  prune(today: DayKey) { plannedStore.set((all) => all.filter((x) => daysBetween(x.addedOn, today) <= GIVE_UP_DAYS)); },
};

/** Due "on that day" means by its end, as Brain reads a bare day (23:59:59). */
export function endOfDayIso(day: DayKey, tz: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(zonedToInstant(y!, m!, d!, 23, 59, tz).getTime() + 59_000).toISOString();
}

export const tomorrowOf = (today: DayKey) => addDaysToKey(today, 1);
