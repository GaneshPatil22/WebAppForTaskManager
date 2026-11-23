import { useState, type FormEvent } from 'react';
import type { Goal, GoalStatus } from '../../api/types';
import { useCreateGoal, useGoals, useItems, useUpdateGoal } from '../../api/queries';
import { isApiError } from '../../api/client';
import { QueryProblem, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import styles from './goals.module.css';

const STATUS_LABEL: Record<GoalStatus, string> = { active: 'Active', achieved: 'Achieved', abandoned: 'Let go' };

export function GoalsPage() {
  const goals = useGoals();
  const items = useItems();
  const create = useCreateGoal();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const counts = new Map<string, { open: number; done: number }>();
  for (const i of items.data ?? []) {
    if (!i.goal.value) continue;
    const c = counts.get(i.goal.value) ?? { open: 0, done: 0 };
    if (i.status === 'open') c.open++; else if (i.status === 'done') c.done++;
    counts.set(i.goal.value, c);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    create.mutate(t, {
      onSuccess: () => { setTitle(''); toast('Goal added.'); },
      onError: (err) => toast(isApiError(err) ? err.message : 'Couldn’t add the goal.'),
    });
  };

  const groups: GoalStatus[] = ['active', 'achieved', 'abandoned'];
  return (
    <>
      <div className="vhead">
        <div className="grow"><h1>Goals</h1><p>Outcomes your items serve. Brain never invents one; only you do. Items serving a goal rank higher.</p></div>
      </div>
      <form className={styles.add} onSubmit={submit}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A new goal, e.g. Ship Brain v1" maxLength={500} aria-label="New goal" />
        <button className="btn primary" type="submit" disabled={create.isPending}><Icon name="plus" size={15} />Add goal</button>
      </form>
      {goals.error ? <QueryProblem error={goals.error} what="goals" onRetry={() => void goals.refetch()} />
        : goals.isLoading ? <Skeleton rows={4} />
        : groups.map((s) => {
          const list = (goals.data ?? []).filter((g) => g.status === s);
          if (!list.length && s !== 'active') return null;
          return (
            <div key={s}>
              <h2 className="section-title">{STATUS_LABEL[s]}</h2>
              <ul className="list">
                {list.length ? list.map((g) => <GoalRow key={g.id} goal={g} counts={counts.get(g.id)} />) : <li className="empty">No active goals yet.</li>}
              </ul>
            </div>
          );
        })}
    </>
  );
}

function GoalRow({ goal, counts }: { goal: Goal; counts?: { open: number; done: number } | undefined }) {
  const update = useUpdateGoal();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const total = (counts?.open ?? 0) + (counts?.done ?? 0);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || t === goal.title) { setEditing(false); return; }
    update.mutate({ id: goal.id, update: { title: t } }, { onSuccess: () => setEditing(false), onError: () => toast('Couldn’t rename.') });
  };
  return (
    <li className={styles.row}>
      <span className={styles.icon}><Icon name="goal" size={18} /></span>
      <div style={{ minWidth: 0 }}>
        {editing ? (
          <form onSubmit={save} className={styles.rename}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={500} aria-label="Goal title" />
            <button className="btn sm primary" type="submit">Save</button>
            <button className="btn sm" type="button" onClick={() => { setTitle(goal.title); setEditing(false); }}>Cancel</button>
          </form>
        ) : <div className={styles.title}>{goal.title}</div>}
        <div className="meta">
          <span>{counts?.open ?? 0} open · {counts?.done ?? 0} done</span>
          {total ? <span className={styles.bar} aria-hidden><i style={{ width: `${((counts?.done ?? 0) / total) * 100}%` }} /></span> : null}
        </div>
      </div>
      <div className={styles.acts}>
        {!editing ? <button className="icon-btn" aria-label={`Rename ${goal.title}`} onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button> : null}
        <select className="input" value={goal.status} aria-label={`Status of ${goal.title}`} style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
          onChange={(e) => update.mutate({ id: goal.id, update: { status: e.target.value as GoalStatus } })}>
          {(['active', 'achieved', 'abandoned'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
    </li>
  );
}
