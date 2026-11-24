import { useMemo } from 'react';
import type { DailyPlan, Item, JournalEntry } from '../../api/types';
import type { DayRange } from '../../api/client';
import { useCommitments, useDailyPlans, useItems, useJournal, useOccurrences, useTimezone } from '../../api/queries';
import type { OccurrenceView } from '../commitments/OccurrenceRow';
import { addDaysToKey, dayKey, type DayKey } from '../../domain/time';

export interface DayData {
  day: DayKey;
  occurrences: OccurrenceView[];
  bigTask?: DailyPlan | undefined;
  journal?: JournalEntry | undefined;
  /** Open items due that day. */
  due: Item[];
}

/**
 * Everything the calendar views show for a range, grouped by day. Only
 * grouping: each occurrence is placed where the server says (`movedTo`,
 * else `day`), and the order within a day is the server's.
 */
export function useDays(range: DayRange) {
  const tz = useTimezone();
  const occ = useOccurrences(range);
  const commitments = useCommitments();
  const plans = useDailyPlans(range);
  const journal = useJournal(range);
  const items = useItems();

  const data = useMemo(() => {
    if (!occ.data || !commitments.data) return undefined;
    const byId = new Map(commitments.data.map((c) => [c.id, c]));
    const out = new Map<DayKey, DayData>();
    for (let d = range.from; d <= range.through; d = addDaysToKey(d, 1)) out.set(d, { day: d, occurrences: [], due: [] });
    for (const o of occ.data) {
      const c = byId.get(o.commitmentId);
      const place = o.movedTo ?? o.day;
      // A moved-away occurrence also shows, quietly, on its own day.
      const at = out.get(place);
      if (c && at && place !== o.day) at.occurrences.push({ commitment: c, day: o.day, place, state: o.state === 'moved' ? undefined : o.state, movedTo: o.movedTo });
      else if (c && at) at.occurrences.push({ commitment: c, day: o.day, place, state: o.state, movedTo: o.movedTo });
      if (c && o.state === 'moved' && o.movedTo && o.movedTo !== o.day) {
        const home = out.get(o.day);
        if (home) home.occurrences.push({ commitment: c, day: o.day, place: o.day, state: 'moved', movedTo: o.movedTo });
      }
    }
    for (const p of plans.data ?? []) { const at = out.get(p.day); if (at) at.bigTask = p; }
    for (const j of journal.data ?? []) { const at = out.get(j.day); if (at) at.journal = j; }
    for (const i of items.data ?? []) {
      if (i.status !== 'open' || !i.dueAt.value) continue;
      const at = out.get(dayKey(new Date(i.dueAt.value), tz));
      if (at) at.due.push(i);
    }
    return [...out.values()];
  }, [occ.data, commitments.data, plans.data, journal.data, items.data, range.from, range.through, tz]);

  return { data, error: occ.error ?? commitments.error ?? null, refetch: () => { void occ.refetch(); void commitments.refetch(); } };
}
