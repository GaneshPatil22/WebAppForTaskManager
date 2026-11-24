import { useState } from 'react';
import { useItemsById, useToday } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { QueryProblem, Skeleton } from '../../ui/components';
import { OccurrenceRow } from '../commitments/OccurrenceRow';
import { DayDetail } from './DayDetail';
import { useDays, type DayData } from './useDays';
import { weekOf } from '../../domain/period';
import { addDaysToKey, D3, dayOfMonthOfKey, longDay, M3, weekdayOfKey, type DayKey } from '../../domain/time';
import styles from './calendar.module.css';

/**
 * Monday to Sunday. Dated commitments (payments, rituals, blocks) are named;
 * daily habits are one line per day, because seven habits times seven days
 * is a wall, not a plan. A past day left undone is not marked as failed:
 * the review is where patterns show.
 */
export function WeekPage() {
  const { today } = useToday();
  const [offset, setOffset] = useState(0);
  const range = weekOf(addDaysToKey(today, offset * 7));
  const days = useDays(range);
  const [open, setOpen] = useState<DayKey | null>(null);
  const openDay = days.data?.find((d) => d.day === open);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Week</h1>
          <p>{label(range.from, range.through)}</p>
        </div>
        <Nav offset={offset} setOffset={setOffset} unit="week" />
      </div>
      {days.error ? <QueryProblem error={days.error} what="the week" onRetry={days.refetch} /> : !days.data ? <Skeleton rows={5} /> : (
        <div className={styles.week}>
          {days.data.map((d) => <WeekDay key={d.day} d={d} today={today} onOpen={() => setOpen(d.day)} />)}
        </div>
      )}
      <Dialog open={!!openDay} onClose={() => setOpen(null)} title={open ? longDay(open) : ''} wide>
        {openDay ? <DayDetail d={openDay} today={today} /> : null}
      </Dialog>
    </>
  );
}

function WeekDay({ d, today, onOpen }: { d: DayData; today: DayKey; onOpen: () => void }) {
  const byId = useItemsById();
  const habits = d.occurrences.filter((o) => o.commitment.rule.kind === 'daily');
  const dated = d.occurrences.filter((o) => o.commitment.rule.kind !== 'daily');
  const hDone = habits.filter((o) => o.state === 'done').length;
  const hDue = habits.filter((o) => o.state !== 'moved' && o.state !== 'skipped').length;
  const big = d.bigTask ? byId.get(d.bigTask.itemId) : undefined;
  return (
    <section className={`${styles.wday} ${d.day === today ? styles.isToday : ''} ${d.day < today ? styles.past : ''}`} aria-label={longDay(d.day)}>
      <button type="button" className={styles.wdayHead} onClick={onOpen}>
        <span className={styles.wdName}>{D3[weekdayOfKey(d.day)]}</span>
        <span className={styles.wdNum}>{dayOfMonthOfKey(d.day)}</span>
        {d.day === today ? <span className="chip">Today</span> : null}
        {d.journal ? <span className={styles.jDot} title="Journal written"><Icon name="journal" size={12} /></span> : null}
      </button>
      {big ? <p className={styles.wBig}><span>Big task</span>{big.title}</p> : null}
      {dated.length ? <ul>{dated.map((o) => <OccurrenceRow key={`${o.commitment.id}|${o.day}|${o.place}`} o={o} today={today} compact />)}</ul> : null}
      {habits.length ? (
        <button type="button" className={styles.habitLine} onClick={onOpen}>
          <span className={styles.habitBar}><i style={{ width: `${hDue ? (hDone / hDue) * 100 : 0}%` }} /></span>
          {d.day <= today ? `${hDone} of ${hDue} daily` : `${hDue} daily`}
        </button>
      ) : null}
      {d.due.length ? <p className={styles.wDue}>{d.due.length} due: {d.due.map((i) => i.title).join(', ')}</p> : null}
    </section>
  );
}

export function Nav({ offset, setOffset, unit }: { offset: number; setOffset: (n: number) => void; unit: string }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button type="button" className="icon-btn" aria-label={`Previous ${unit}`} onClick={() => setOffset(offset - 1)}><Icon name="left" /></button>
      <button type="button" className="btn sm" disabled={offset === 0} onClick={() => setOffset(0)}>This {unit}</button>
      <button type="button" className="icon-btn" aria-label={`Next ${unit}`} onClick={() => setOffset(offset + 1)}><Icon name="right" /></button>
    </div>
  );
}

function label(from: DayKey, through: DayKey) {
  const m = (k: DayKey) => M3[Number(k.slice(5, 7)) - 1];
  return `${dayOfMonthOfKey(from)} ${m(from)} – ${dayOfMonthOfKey(through)} ${m(through)} ${through.slice(0, 4)}`;
}
