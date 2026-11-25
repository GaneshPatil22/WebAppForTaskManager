import { useMemo } from 'react';
import type { Item } from '../../api/types';
import { useGoalsById, useItems, useToday, useUpdateItem } from '../../api/queries';
import { useOpenItem } from '../../app/itemSheet';
import { openCapture } from '../../app/Shell';
import { Icon } from '../../ui/Icon';
import { QueryProblem, Skeleton, Val, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { daysBetween, dayKey } from '../../domain/time';
import { MADE_TASK } from '../items/ItemEditor';
import styles from './ideas.module.css';

/**
 * Ideas are kept, not planned (Brain 0.11.0): capturing a thought is not
 * committing to act on it, so they never appear in Today. They live here,
 * newest first, until you make one a task (then Brain plans it) or drop it.
 * A filter of /v1/items, nothing ranked.
 */
export function IdeasPage() {
  const items = useItems();
  const update = useUpdateItem();
  const toast = useToast();
  // Actions live here, not on the row: the row unmounts the moment its idea
  // becomes a task or is dropped (the list updates at once), and an
  // unmounted row would never see its own success callback.
  const act: Actions = {
    task: (i) => update.mutate({ id: i.id, update: { type: 'task' } }, { onSuccess: () => toast(MADE_TASK), onError: (e) => toast(errorText(e)) }),
    drop: (i) => update.mutate({ id: i.id, update: { status: 'dropped' } }, {
      onSuccess: () => toast('Dropped.', { label: 'Undo', run: () => update.mutate({ id: i.id, update: { status: 'open' } }) }),
      onError: (e) => toast(errorText(e)),
    }),
  };
  const ideas = useMemo(
    () => [...(items.data ?? [])].filter((i) => i.status === 'open' && i.type.value === 'idea').reverse(),
    [items.data],
  );
  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Ideas</h1><p>Thoughts you’re keeping, not planning. Make one a task when you want Brain to plan it.</p></div>
        <button type="button" className="btn" onClick={openCapture}><Icon name="plus" size={14} />Capture</button>
      </div>
      {items.error ? <QueryProblem error={items.error} what="your ideas" onRetry={() => void items.refetch()} />
        : !items.data ? <Skeleton rows={4} />
        : ideas.length ? <ul className={styles.list} aria-label="Ideas">{ideas.map((i) => <IdeaRow key={i.id} item={i} act={act} />)}</ul>
        : <p className="empty">No ideas yet. Capture one starting with “idea:” or “what if”, and it lands here instead of in your plan.</p>}
    </>
  );
}

function age(createdAt: string, today: string, tz: string): string {
  const n = daysBetween(dayKey(new Date(createdAt), tz), today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}

interface Actions { task: (i: Item) => void; drop: (i: Item) => void }

function IdeaRow({ item, act }: { item: Item; act: Actions }) {
  const open = useOpenItem();
  const goals = useGoalsById();
  const { today, tz } = useToday();
  const goal = item.goal.value ? goals.get(item.goal.value) : undefined;
  return (
    <li className={styles.row}>
      <button type="button" className={styles.main} onClick={() => open(item.id)}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.meta}>
          {goal ? <><Icon name="goal" size={12} /><Val by={item.goal.decidedBy}>{goal.title}</Val><span aria-hidden> · </span></> : null}
          {age(item.createdAt, today, tz)}
        </span>
      </button>
      <span className={styles.actions}>
        <button type="button" className="btn sm" aria-label={`Make it a task: ${item.title}`}
          onClick={() => act.task(item)}>
          Make it a task
        </button>
        <button type="button" className="btn sm quiet" aria-label={`Drop: ${item.title}`}
          onClick={() => act.drop(item)}>
          Drop
        </button>
      </span>
    </li>
  );
}
