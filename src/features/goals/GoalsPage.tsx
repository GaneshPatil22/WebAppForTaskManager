import { useMemo, useState, type FormEvent } from 'react';
import type { Goal, GoalUpdate, Period } from '../../api/types';
import { useCreateGoal, useGoals, useToday, useUpdateGoal } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { QueryProblem, Skeleton, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { monthOf, monthsIn, parsePeriod, periodBounds, periodLabel, quarterOf, quarterOfMonth, shiftPeriod } from '../../domain/period';
import type { DayKey } from '../../domain/time';
import styles from './goals.module.css';

/**
 * Goals by period: each quarter with the month goals that roll up into it.
 * Brain never creates a goal; it only counts the ones you set, and only
 * while their period hasn't passed.
 */
export function GoalsPage() {
  const goals = useGoals();
  const { today } = useToday();
  const [adding, setAdding] = useState<Partial<NewGoalDraft> | null>(null);

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Goals</h1><p>Set for a month or a quarter. A month goal can roll up into its quarter. Only you create goals.</p></div>
        <button type="button" className="btn primary" onClick={() => setAdding({})}><Icon name="plus" size={14} />New goal</button>
      </div>
      {goals.error ? <QueryProblem error={goals.error} what="goals" onRetry={() => void goals.refetch()} /> : !goals.data ? <Skeleton /> : (
        <GoalTree goals={goals.data} today={today} onAdd={setAdding} />
      )}
      <Dialog open={!!adding} onClose={() => setAdding(null)} title="New goal">
        {adding ? <GoalForm goals={goals.data ?? []} today={today} initial={adding} onDone={() => setAdding(null)} /> : null}
      </Dialog>
    </>
  );
}

function GoalTree({ goals, today, onAdd }: { goals: Goal[]; today: DayKey; onAdd: (d: Partial<NewGoalDraft>) => void }) {
  const thisQ = quarterOf(today);
  const quarters = useMemo(() => {
    const qs = new Set<Period>([thisQ, shiftPeriod(thisQ, 1)]);
    for (const g of goals) if (g.period) qs.add(parsePeriod(g.period)?.horizon === 'quarter' ? g.period : quarterOfMonth(g.period));
    return [...qs].sort().reverse();
  }, [goals, thisQ]);
  const current = quarters.filter((q) => periodBounds(q).through >= today).reverse();
  const past = quarters.filter((q) => periodBounds(q).through < today);
  const openEnded = goals.filter((g) => !g.period);

  return (
    <>
      {current.map((q) => <QuarterBlock key={q} q={q} goals={goals} today={today} onAdd={onAdd} />)}
      {openEnded.length ? (
        <section className={styles.block}>
          <h2 className={styles.qh}>No period</h2>
          <p className="sub">Open-ended goals always count while active.</p>
          <ul className={styles.goals}>{openEnded.map((g) => <GoalItem key={g.id} goal={g} goals={goals} />)}</ul>
        </section>
      ) : null}
      {past.length ? (
        <details className={styles.past}>
          <summary>Earlier quarters ({past.length})</summary>
          {past.map((q) => <QuarterBlock key={q} q={q} goals={goals} today={today} onAdd={onAdd} />)}
        </details>
      ) : null}
    </>
  );
}

function QuarterBlock({ q, goals, today, onAdd }: { q: Period; goals: Goal[]; today: DayKey; onAdd: (d: Partial<NewGoalDraft>) => void }) {
  const qGoals = goals.filter((g) => g.period === q);
  const lapsed = periodBounds(q).through < today;
  return (
    <section className={styles.block}>
      <div className={styles.qHead}>
        <h2 className={styles.qh}>{periodLabel(q)}{q === quarterOf(today) ? <span className="chip">Now</span> : null}</h2>
        {!lapsed ? <button type="button" className="link-btn" onClick={() => onAdd({ period: q })}>+ Quarter goal</button> : null}
      </div>
      {qGoals.length ? (
        <ul className={styles.goals}>
          {qGoals.map((g) => (
            <GoalItem key={g.id} goal={g} goals={goals}>
              {goals.filter((c) => c.parentId === g.id).map((c) => <GoalItem key={c.id} goal={c} goals={goals} child />)}
            </GoalItem>
          ))}
        </ul>
      ) : <p className="sub">No quarter goals.</p>}
      <div className={styles.months}>
        {monthsIn(q).map((m) => {
          const loose = goals.filter((g) => g.period === m && !qGoals.some((p) => p.id === g.parentId));
          const mLapsed = periodBounds(m).through < today;
          if (mLapsed && !loose.length) return null;
          return (
            <div key={m} className={styles.month}>
              <div className={styles.qHead}>
                <h3>{periodLabel(m)}{m === monthOf(today) ? <span className="chip">Now</span> : null}</h3>
                {!mLapsed ? <button type="button" className="link-btn" onClick={() => onAdd({ period: m })}>+ Month goal</button> : null}
              </div>
              {loose.length ? <ul className={styles.goals}>{loose.map((g) => <GoalItem key={g.id} goal={g} goals={goals} />)}</ul>
                : <p className="sub">{goals.some((g) => g.period === m) ? 'All roll up into a quarter goal above.' : 'Nothing set.'}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GoalItem({ goal, goals, child = false, children }: { goal: Goal; goals: Goal[]; child?: boolean; children?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateGoal();
  const toast = useToast();
  const set = (u: GoalUpdate, msg: string) => update.mutate({ id: goal.id, update: u }, { onSuccess: () => toast(msg), onError: (e) => toast(errorText(e)) });
  const closed = goal.status !== 'active';
  return (
    <li className={`${styles.goal} ${child ? styles.child : ''} ${closed ? styles.closed : ''}`}>
      <div className={styles.goalRow}>
        <Icon name={goal.status === 'achieved' ? 'check' : 'goal'} size={15} />
        <button type="button" className={styles.goalTitle} onClick={() => setEditing(true)}>{goal.title}</button>
        {child && goal.periodText ? <span className="sub">{goal.periodText}</span> : null}
        {goal.status === 'achieved' ? <span className="chip sched">Achieved</span> : goal.status === 'abandoned' ? <span className="chip">Let go</span> : null}
        <span style={{ flex: 1 }} />
        {closed ? <button type="button" className="btn sm quiet" onClick={() => set({ status: 'active' }, 'Reopened.')}>Reopen</button> : (
          <button type="button" className="btn sm quiet" onClick={() => set({ status: 'achieved' }, 'Achieved. Well done.')}>Achieved</button>
        )}
      </div>
      {children ? <ul>{children}</ul> : null}
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit goal">
        {editing ? <EditGoal goal={goal} goals={goals} onDone={() => setEditing(false)} /> : null}
      </Dialog>
    </li>
  );
}

interface NewGoalDraft { title: string; period: Period | ''; parentId: string }

/** Periods worth offering: this and the next two months and quarters, plus any already given. */
function periodOptions(today: DayKey, extra?: Period): Period[] {
  const m = monthOf(today);
  const q = quarterOf(today);
  const set = new Set<Period>([m, shiftPeriod(m, 1), shiftPeriod(m, 2), q, shiftPeriod(q, 1), shiftPeriod(q, 2)]);
  if (extra) set.add(extra);
  return [...set].sort((a, b) => periodBounds(a).from.localeCompare(periodBounds(b).from) || (parsePeriod(a)!.horizon === 'quarter' ? -1 : 1));
}

/** Quarter goals a month goal could roll up into: those whose quarter holds the month. */
function parentOptions(goals: Goal[], period: Period | '', self?: string): Goal[] {
  if (!period || parsePeriod(period)?.horizon !== 'month') return [];
  const q = quarterOfMonth(period);
  return goals.filter((g) => g.period === q && g.id !== self && g.status === 'active');
}

function GoalForm({ goals, today, initial, onDone }: { goals: Goal[]; today: DayKey; initial: Partial<NewGoalDraft>; onDone: () => void }) {
  const create = useCreateGoal();
  const toast = useToast();
  const [d, setD] = useState<NewGoalDraft>({ title: '', period: initial.period ?? monthOf(today), parentId: '' });
  const [err, setErr] = useState<string | null>(null);
  const parents = parentOptions(goals, d.period);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    create.mutate({ title: d.title.trim(), ...(d.period ? { period: d.period } : {}), ...(d.parentId ? { parentId: d.parentId } : {}) }, {
      onSuccess: () => { toast('Goal set.'); onDone(); },
      onError: (e2) => setErr(errorText(e2)),
    });
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field"><span>Goal</span>
        <input className="input" autoFocus value={d.title} maxLength={500} placeholder="Start the iOS contract job hunt" onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <PeriodFields d={d} setD={setD} today={today} parents={parents} />
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="form-actions"><button type="button" className="btn quiet" onClick={onDone}>Cancel</button><button className="btn primary" disabled={!d.title.trim() || create.isPending}>Set goal</button></div>
    </form>
  );
}

function PeriodFields({ d, setD, today, parents, current }: { d: NewGoalDraft; setD: (d: NewGoalDraft) => void; today: DayKey; parents: Goal[]; current?: Period | undefined }) {
  return (
    <div className="form-grid">
      <label className="field"><span>For</span>
        <select className="input" value={d.period} onChange={(e) => setD({ ...d, period: e.target.value, parentId: '' })}>
          {periodOptions(today, current).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
          <option value="">No period (open-ended)</option>
        </select>
      </label>
      {parents.length ? (
        <label className="field"><span>Rolls up into</span>
          <select className="input" value={d.parentId} onChange={(e) => setD({ ...d, parentId: e.target.value })}>
            <option value="">Nothing</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function EditGoal({ goal, goals, onDone }: { goal: Goal; goals: Goal[]; onDone: () => void }) {
  const update = useUpdateGoal();
  const { today } = useToday();
  const toast = useToast();
  const [d, setD] = useState<NewGoalDraft>({ title: goal.title, period: goal.period ?? '', parentId: goal.parentId ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const parents = parentOptions(goals, d.period, goal.id);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const u: GoalUpdate = {};
    const clear: NonNullable<GoalUpdate['clear']> = [];
    if (d.title.trim() && d.title.trim() !== goal.title) u.title = d.title.trim();
    if (d.period !== (goal.period ?? '')) { if (d.period) u.period = d.period; else clear.push('period'); }
    if (d.parentId !== (goal.parentId ?? '')) { if (d.parentId) u.parentId = d.parentId; else clear.push('parentId'); }
    if (clear.length) u.clear = clear;
    if (!Object.keys(u).length) { onDone(); return; }
    update.mutate({ id: goal.id, update: u }, { onSuccess: () => { toast('Saved.'); onDone(); }, onError: (e2) => setErr(errorText(e2)) });
  };
  const status = (s: Goal['status'], msg: string) => update.mutate({ id: goal.id, update: { status: s } }, { onSuccess: () => { toast(msg); onDone(); }, onError: (e2) => setErr(errorText(e2)) });

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field"><span>Goal</span><input className="input" value={d.title} maxLength={500} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
      <PeriodFields d={d} setD={setD} today={today} parents={parents} current={goal.period} />
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="form-actions">
        {goal.status === 'active' ? <button type="button" className="btn quiet" onClick={() => status('abandoned', 'Let go. It no longer counts.')}>Let it go</button> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={update.isPending}>Save</button>
      </div>
    </form>
  );
}
