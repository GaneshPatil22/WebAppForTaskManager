import { useMemo, useState } from 'react';
import type { Item } from '../../api/types';
import { useItems, useToday } from '../../api/queries';
import { addDaysToKey, D3, dayKey, DAYS, fmtMinutes, M3, mondayOfKey, dayOfMonthOfKey } from '../../domain/time';
import { EFFORT_MINUTES } from '../../domain/labels';
import { isOn, viewPrefsStore } from '../../domain/views';
import { planner, plannerStore } from '../../local/planner';
import { repeats, repeatsStore, isDueOn } from '../../local/repeats';
import { InProgress, QueryProblem, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import { useOpenItem } from '../../app/itemSheet';
import { ItemRow } from '../items/ItemRow';
import styles from './week.module.css';

const ACTIONABLE = (i: Item) => i.type.value !== 'idea' && i.type.value !== 'note' && i.type.value !== 'link';

export function WeekPage() {
  const items = useItems();
  const local = plannerStore.use();
  const reps = repeatsStore.use();
  const prefs = viewPrefsStore.use();
  const { today, tz } = useToday();
  const [offset, setOffset] = useState(0);
  const open = useOpenItem();
  const toast = useToast();

  const mon = addDaysToKey(mondayOfKey(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(mon, i));
  const showRepeats = isOn(prefs, 'repeats');

  const byDay = useMemo(() => {
    const m = new Map<string, { item: Item; why: 'due' | 'planned' }[]>();
    for (const i of items.data ?? []) {
      if (i.status === 'dropped') continue;
      const planned = local.plannedDay[i.id];
      const due = i.dueAt.value ? dayKey(new Date(i.dueAt.value), tz) : undefined;
      const k = planned ?? due;
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), { item: i, why: planned ? 'planned' : 'due' }]);
    }
    return m;
  }, [items.data, local.plannedDay, tz]);

  const unplanned = (items.data ?? []).filter((i) => i.status === 'open' && ACTIONABLE(i) && !i.dueAt.value && !local.plannedDay[i.id]);
  const daily = reps.filter((r) => r.kind === 'daily' && !r.paused);

  return (
    <>
      <div className="vhead">
        <div className="grow">
          <h1>{offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : 'Week'} <InProgress note="Due dates come from Brain. Days you plan, and repeats, are kept on this device." /></h1>
          <p>{dayOfMonthOfKey(mon)} {M3[Number(mon.slice(5, 7)) - 1]} to {dayOfMonthOfKey(days[6]!)} {M3[Number(days[6]!.slice(5, 7)) - 1]}. Due dates are Brain’s; days you plan stay on this device.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="icon-btn" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}><Icon name="left" size={15} /></button>
          <button className="btn sm" onClick={() => setOffset(0)} disabled={offset === 0}>This week</button>
          <button className="icon-btn" aria-label="Next week" onClick={() => setOffset((o) => o + 1)}><Icon name="right" size={15} /></button>
        </div>
      </div>

      {showRepeats && daily.length ? (
        <div className={styles.band}><Icon name="repeat" size={16} /><span>Every day</span>
          {daily.map((r) => <span key={r.id} className="chip daily" style={{ background: 'var(--surface)' }}>{r.title}, {fmtMinutes(r.minutes)}</span>)}
        </div>
      ) : null}

      {items.error ? <QueryProblem error={items.error} what="items" /> : items.isLoading ? <Skeleton rows={3} /> : (
        <div className={styles.week}>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const rs = showRepeats ? reps.filter((r) => r.kind !== 'daily' && isDueOn(r, d)) : [];
            return (
              <div key={d} className={`${styles.day} ${d === today ? styles.today : ''}`}>
                <div className={styles.dh}><b>{dayOfMonthOfKey(d)}</b><span>{D3[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span></div>
                {list.map(({ item, why }) => (
                  <button key={item.id} className={`${styles.mini} ${item.status !== 'open' ? styles.miniDone : ''}`} onClick={() => open(item.id)}>
                    {item.title}<small>{why === 'due' ? 'due' : 'planned'} · {fmtMinutes(EFFORT_MINUTES[item.effort.value ?? 'unknown'])}</small>
                  </button>
                ))}
                {rs.map((r) => {
                  const done = r.doneOn.includes(d);
                  return (
                    <button key={r.id} className={`${styles.mini} ${styles[r.kind]} ${done ? styles.miniDone : ''}`}
                      onClick={() => d <= today ? repeats.toggleDone(r.id, d) : undefined} title={d <= today ? 'Tap to mark done' : 'Upcoming'}>
                      {r.title}<small>repeat · {fmtMinutes(r.minutes)}</small>
                    </button>
                  );
                })}
                {!list.length && !rs.length ? <div className={styles.dempty}>Nothing planned</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="section-title">No day yet</h2>
      <p className="sub" style={{ marginBottom: 10 }}>Open items with no due date. Planning a day doesn’t change Brain’s ranking; it’s just for you.</p>
      <ul className="list">
        {unplanned.length ? unplanned.map((i) => (
          <ItemRow key={i.id} item={i} actions={
            <select className="input" style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }} value="" aria-label={`Plan ${i.title} on a day`}
              onChange={(e) => { if (!e.target.value) return; planner.planOn(i.id, e.target.value); toast(`Planned for ${DAYS[new Date(`${e.target.value}T12:00:00Z`).getUTCDay()]}.`, { label: 'Undo', run: () => planner.planOn(i.id, null) }); }}>
              <option value="">Pick a day</option>
              {days.filter((d) => d >= today).map((d) => <option key={d} value={d}>{DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} {dayOfMonthOfKey(d)}</option>)}
            </select>
          } />
        )) : <li className="empty">Everything open has a day.</li>}
      </ul>
    </>
  );
}
