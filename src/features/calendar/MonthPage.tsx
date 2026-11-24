import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useGoals, useToday } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { QueryProblem, Skeleton } from '../../ui/components';
import { Nav } from './WeekPage';
import { DayDetail } from './DayDetail';
import { useDays } from './useDays';
import { monthOf, periodBounds, periodLabel, quarterOfMonth, shiftPeriod } from '../../domain/period';
import { D3, dayOfMonthOfKey, longDay, weekdayOfKey, type DayKey } from '../../domain/time';
import { GoalLine } from '../goals/GoalLine';
import styles from './calendar.module.css';

/**
 * The month: its goals first (and the quarter they roll up into), then the
 * calendar. Only dated commitments appear in the grid; daily habits would
 * fill every square with the same seven things.
 */
export function MonthPage() {
  const { today } = useToday();
  const [offset, setOffset] = useState(0);
  const month = shiftPeriod(monthOf(today), offset);
  const range = periodBounds(month);
  const days = useDays(range);
  const goals = useGoals();
  const [open, setOpen] = useState<DayKey | null>(null);
  const openDay = days.data?.find((d) => d.day === open);
  const quarter = quarterOfMonth(month);
  const monthGoals = (goals.data ?? []).filter((g) => g.period === month);
  const quarterGoals = (goals.data ?? []).filter((g) => g.period === quarter);
  const lead = (weekdayOfKey(range.from) + 6) % 7;

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>{periodLabel(month)}</h1><p>Goals for the month, and what’s on each day.</p></div>
        <Nav offset={offset} setOffset={setOffset} unit="month" />
      </div>

      <section className={styles.goalsBand}>
        <div>
          <h2 className={styles.bandH}>{periodLabel(month)} goals</h2>
          {goals.error ? <QueryProblem error={goals.error} what="goals" /> : monthGoals.length ? (
            <ul>{monthGoals.map((g) => <GoalLine key={g.id} goal={g} parent={g.parentId ? goals.data?.find((p) => p.id === g.parentId) : undefined} />)}</ul>
          ) : <p className="sub">None set. <Link to="/goals">Set this month’s goals</Link>. Only you create goals.</p>}
        </div>
        <div>
          <h2 className={styles.bandH}>{periodLabel(quarter)}</h2>
          {quarterGoals.length ? <ul>{quarterGoals.map((g) => <GoalLine key={g.id} goal={g} />)}</ul> : <p className="sub">No quarter goals.</p>}
        </div>
      </section>

      {days.error ? <QueryProblem error={days.error} what="the month" onRetry={days.refetch} /> : !days.data ? <Skeleton rows={5} /> : (
        <div className={styles.month} role="grid" aria-label={periodLabel(month)}>
          {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className={styles.mHead} role="columnheader">{D3[w]}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} className={styles.mPad} />)}
          {days.data.map((d) => {
            const dated = d.occurrences.filter((o) => o.commitment.rule.kind !== 'daily' && o.state !== 'moved');
            return (
              <button key={d.day} type="button" role="gridcell" onClick={() => setOpen(d.day)}
                className={`${styles.mDay} ${d.day === today ? styles.isToday : ''} ${d.day < today ? styles.past : ''}`}
                aria-label={`${longDay(d.day)}${dated.length ? `, ${dated.length} commitments` : ''}`}>
                <span className={styles.mNum}>{dayOfMonthOfKey(d.day)}
                  {d.bigTask ? <i className={styles.bigDot} title="Big task confirmed" /> : null}
                  {d.journal ? <Icon name="journal" size={11} /> : null}
                </span>
                {dated.slice(0, 3).map((o) => (
                  <span key={o.commitment.id + o.day} className={`${styles.mItem} ${o.state === 'done' ? styles.mDone : ''} ${o.commitment.kind === 'payment' ? styles.mPay : ''}`}>
                    {o.commitment.title}{o.commitment.note ? ` ${o.commitment.note}` : ''}
                  </span>
                ))}
                {dated.length > 3 ? <span className={styles.mMore}>+{dated.length - 3}</span> : null}
                {d.due.length ? <span className={styles.mDue}>{d.due.length} due</span> : null}
              </button>
            );
          })}
        </div>
      )}
      <Dialog open={!!openDay} onClose={() => setOpen(null)} title={open ? longDay(open) : ''} wide>
        {openDay ? <DayDetail d={openDay} today={today} /> : null}
      </Dialog>
    </>
  );
}
