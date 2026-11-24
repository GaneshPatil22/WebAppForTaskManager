import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { CommitmentReview, Goal, GoalReview } from '../../api/types';
import type { DayRange } from '../../api/client';
import { useDailyPlans, useItemsById, useJournal, useReview, useToday, useUpdateGoal } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { QueryProblem, Skeleton, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { KIND_ICON } from '../commitments/OccurrenceRow';
import { Nav } from '../calendar/WeekPage';
import { monthOf, periodBounds, periodLabel, quarterOf, shiftPeriod, weekOf } from '../../domain/period';
import { addDaysToKey, dayOfMonthOfKey, daysBetween, M3, shortDay, weekdayOfKey, type DayKey } from '../../domain/time';
import styles from './review.module.css';

type Scope = 'week' | 'month' | 'quarter';

/**
 * The Sunday review and the first-Saturday monthly review. This is where
 * patterns surface ("4 of 7 on reading"), not the daily view. Counts only:
 * no amounts are ever added up, and a commitment with no history is normal.
 */
export function ReviewPage() {
  const { today } = useToday();
  // Early in a month, the monthly review looks back at the month just ended.
  const [scope, setScope] = useState<Scope>(() => (weekdayOfKey(today) !== 0 && dayOfMonthOfKey(today) <= 7 ? 'month' : 'week'));
  const [offset, setOffset] = useState(() => (scope === 'month' && dayOfMonthOfKey(today) <= 7 ? -1 : 0));
  const range = rangeFor(scope, today, offset);
  const review = useReview(range);

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Review</h1><p>{title(scope, range)}</p></div>
        <div className="seg" role="tablist" aria-label="Period">
          {(['week', 'month', 'quarter'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} onClick={() => { setScope(s); setOffset(0); }}>{s[0]!.toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <Nav offset={offset} setOffset={setOffset} unit={scope} />
      </div>

      {review.error ? <QueryProblem error={review.error} what="the review" onRetry={() => void review.refetch()} /> : !review.data ? <Skeleton rows={5} /> : (
        <>
          <section className={styles.stats}>
            <Stat n={review.data.bigTasksConfirmed} label="big tasks confirmed" sub={review.data.bigTasksSwapped ? `${review.data.bigTasksSwapped} swapped from Brain’s pick` : 'all Brain’s pick'} />
            <Stat n={review.data.journalEntries} label="journal entries" sub={`of ${daysElapsed(range, today)} days`} />
            <Stat n={review.data.commitments.reduce((a, c) => a + c.done, 0)} label="commitments kept" sub={`of ${review.data.commitments.reduce((a, c) => a + c.expected, 0)} expected`} />
          </section>

          <div className="section-head"><h2>Commitments</h2><span className="grow" /><span className="sub">Done of expected · a missed day only resets a streak</span></div>
          {review.data.commitments.length ? (
            <ul className={styles.rows}>{review.data.commitments.map((c) => <CommitmentLine key={c.commitment.id} r={c} />)}</ul>
          ) : <p className="empty">Nothing was scheduled in this period.</p>}

          <div className="section-head"><h2>Goals</h2><span className="grow" /><Link to="/goals" className="link-btn">{scope === 'month' ? 'Set next month’s goals' : 'All goals'}</Link></div>
          <Goals goals={review.data.goals} today={today} />

          <BigTasks range={range} />
          <Journal range={range} />
        </>
      )}
    </>
  );
}

function rangeFor(scope: Scope, today: DayKey, offset: number): DayRange {
  if (scope === 'week') return weekOf(addDaysToKey(today, offset * 7));
  return periodBounds(shiftPeriod(scope === 'month' ? monthOf(today) : quarterOf(today), offset));
}

function title(scope: Scope, r: DayRange) {
  if (scope === 'week') return `Week of ${dayOfMonthOfKey(r.from)} ${M3[Number(r.from.slice(5, 7)) - 1]}, Monday to Sunday`;
  return periodLabel(scope === 'month' ? monthOf(r.from) : quarterOf(r.from));
}

function daysElapsed(r: DayRange, today: DayKey) {
  const end = r.through < today ? r.through : today;
  return end < r.from ? 0 : daysBetween(r.from, end) + 1;
}

function Stat({ n, label, sub }: { n: number; label: string; sub: string }) {
  return <div className={styles.stat}><b className="tnum">{n}</b><span>{label}</span><small>{sub}</small></div>;
}

function CommitmentLine({ r }: { r: CommitmentReview }) {
  const c = r.commitment;
  const pct = r.expected ? r.done / r.expected : 0;
  const notes = [
    r.missed ? `${r.missed} missed` : '',
    r.skipped ? `${r.skipped} skipped` : '',
    r.moved ? `${r.moved} moved ahead` : '',
    c.kind === 'habit' && r.streak ? `${r.streak}-day streak now` : '',
  ].filter(Boolean);
  return (
    <li className={styles.row}>
      <span className={styles.icon}><Icon name={KIND_ICON[c.kind]} size={15} /></span>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>{c.title}</span>
          <span className="tnum"><b>{r.done}</b> of {r.expected}</span>
        </div>
        <div className={styles.bar} aria-hidden><i style={{ width: `${pct * 100}%` }} /></div>
        {notes.length ? <span className="sub">{notes.join(' · ')}</span> : null}
      </div>
    </li>
  );
}

function Goals({ goals, today }: { goals: GoalReview[]; today: DayKey }) {
  if (!goals.length) return <p className="empty">No goals for this period. <Link to="/goals">Set one</Link>; Brain never makes them up.</p>;
  // Month goals already shown under their quarter aren't repeated.
  const nested = new Set(goals.flatMap((g) => g.children.map((c) => c.id)));
  return (
    <ul className={styles.goals}>
      {goals.filter((g) => !nested.has(g.goal.id)).map((g) => (
        <li key={g.goal.id}>
          <GoalReviewLine goal={g.goal} today={today} />
          {g.children.length ? <ul className={styles.children}>{g.children.map((c) => <li key={c.id}><GoalReviewLine goal={c} today={today} /></li>)}</ul> : null}
        </li>
      ))}
    </ul>
  );
}

function GoalReviewLine({ goal, today }: { goal: Goal; today: DayKey }) {
  const update = useUpdateGoal();
  const toast = useToast();
  const ended = goal.period ? periodBounds(goal.period).through < today : false;
  const set = (status: Goal['status'], msg: string) => update.mutate({ id: goal.id, update: { status } }, { onSuccess: () => toast(msg), onError: (e) => toast(errorText(e)) });
  return (
    <div className={styles.goal}>
      <Icon name={goal.status === 'achieved' ? 'check' : 'goal'} size={15} />
      <span className={styles.goalTitle}>{goal.title}</span>
      {goal.periodText ? <span className="sub">{goal.periodText}</span> : null}
      <span style={{ flex: 1 }} />
      {goal.status === 'active' ? (
        <>
          {ended ? <span className="chip">Period ended · no longer counts</span> : null}
          <button type="button" className="btn sm" onClick={() => set('achieved', 'Achieved.')}>Achieved</button>
          <button type="button" className="btn sm quiet" onClick={() => set('abandoned', 'Let go.')}>Let go</button>
        </>
      ) : <span className={`chip ${goal.status === 'achieved' ? 'sched' : ''}`}>{goal.status === 'achieved' ? 'Achieved' : 'Let go'}</span>}
    </div>
  );
}

function BigTasks({ range }: { range: DayRange }) {
  const plans = useDailyPlans(range);
  const byId = useItemsById();
  if (!plans.data?.length) return null;
  return (
    <>
      <div className="section-head"><h2>Big tasks</h2></div>
      <ul className={styles.plain}>
        {plans.data.map((p) => (
          <li key={p.day}>
            <span className={styles.day}>{shortDay(p.day)}</span>
            <span>{byId.get(p.itemId)?.title ?? 'An item'}{byId.get(p.itemId)?.status === 'done' ? <span className="chip sched" style={{ marginLeft: 6 }}>done</span> : null}</span>
            {p.swapped ? <span className="sub">swapped from “{p.proposedItemId ? byId.get(p.proposedItemId)?.title ?? 'Brain’s pick' : 'Brain’s pick'}”</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function Journal({ range }: { range: DayRange }) {
  const j = useJournal(range);
  if (!j.data?.length) return null;
  return (
    <>
      <div className="section-head"><h2>Journal</h2><span className="grow" /><Link to="/journal" className="link-btn">Open journal</Link></div>
      <details open={j.data.length <= 7}>
        <summary className="sub" style={{ cursor: 'pointer', marginBottom: 8 }}>{j.data.length} entr{j.data.length === 1 ? 'y' : 'ies'}</summary>
        <ul className={styles.plain}>
          {j.data.map((e) => <li key={e.day}><span className={styles.day}>{shortDay(e.day)}</span><span style={{ whiteSpace: 'pre-wrap' }}>{e.body}</span></li>)}
        </ul>
      </details>
    </>
  );
}
