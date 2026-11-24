import { useEffect, useRef } from 'react';
import { useItems, useToday, useUpdateItem } from '../../api/queries';
import { dayKey } from '../../domain/time';
import { endOfDayIso, planned, plannedStore } from '../../local/planned';

/**
 * Sets the planned day on items added from "Plan tomorrow", once Brain has
 * made them. Mounted once, in the shell. One request per item at a time;
 * a failure is simply tried again on the next change.
 */
export function PlannedRunner() {
  const entries = plannedStore.use();
  const items = useItems();
  const { tz, today } = useToday();
  const update = useUpdateItem();
  const inFlight = useRef(new Set<string>());

  useEffect(() => { planned.prune(today); }, [today]);

  useEffect(() => {
    if (!entries.length || !items.data) return;
    for (const e of entries) {
      const item = items.data.find((i) => i.captureId === e.captureId);
      if (!item || inFlight.current.has(e.captureId)) continue;
      const due = item.dueAt.value;
      if (due && item.dueAt.decidedBy === 'user' && dayKey(new Date(due), tz) === e.day) { planned.done(e.captureId); continue; }
      inFlight.current.add(e.captureId);
      update.mutate({ id: item.id, update: { dueAt: endOfDayIso(e.day, tz) } }, {
        onSuccess: () => planned.done(e.captureId),
        onSettled: () => inFlight.current.delete(e.captureId),
      });
    }
  }, [entries, items.data, tz, update]);
  return null;
}
