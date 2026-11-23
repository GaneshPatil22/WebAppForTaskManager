import type { ReactNode } from 'react';
import type { Item, RankedItem } from '../../api/types';
import { useGoalsById, useToday, useUpdateItem } from '../../api/queries';
import { CATEGORY_LABEL, EFFORT_SHORT, TYPE_LABEL, decidedByLabel } from '../../domain/labels';
import { dueLabel } from '../../domain/time';
import { Icon } from '../../ui/Icon';
import { useOpenItem } from '../../app/itemSheet';
import { useToast } from '../../ui/toast';
import styles from './items.module.css';

/** Suggested values are dashed; values the user set are solid. */
function Field({ suggested, title, children, tone }: { suggested: boolean; title: string; children: ReactNode; tone?: string }) {
  return <span className={`chip ${suggested ? 'suggested' : ''} ${tone ?? ''}`} title={title}>{children}</span>;
}

export function ItemMeta({ item, ranked, compact }: { item: Item; ranked?: RankedItem | undefined; compact?: boolean }) {
  const goals = useGoalsById();
  const { now, tz } = useToday();
  const s = (d: Item['type']['decidedBy']) => decidedByLabel(d).suggested;
  const goal = item.goal.value ? goals.get(item.goal.value) : undefined;
  const due = item.dueAt.value ? dueLabel(item.dueAt.value, now, tz) : null;
  return (
    <div className="meta">
      {!compact ? (
        item.type.value
          ? <Field suggested={s(item.type.decidedBy)} title={decidedByLabel(item.type.decidedBy).text}>{TYPE_LABEL[item.type.value]}</Field>
          : <span className="chip suggested" title="Brain wasn’t sure, so it didn’t guess">Type?</span>
      ) : null}
      {item.effort.value && item.effort.value !== 'unknown'
        ? <Field suggested={s(item.effort.decidedBy)} title={decidedByLabel(item.effort.decidedBy).text}>{EFFORT_SHORT[item.effort.value]}</Field>
        : <span className="chip suggested" title="No effort given. Scored as medium.">Effort?</span>}
      {due ? <Field suggested={s(item.dueAt.decidedBy)} title={decidedByLabel(item.dueAt.decidedBy).text} tone={due.urgent ? 'danger' : ''}>{due.text}</Field> : null}
      {goal ? <span className={styles.goal}><Icon name="goal" size={12} />{goal.title}</span> : null}
      {!compact && item.category.value ? <span>{CATEGORY_LABEL[item.category.value]}</span> : null}
      {ranked && ranked.why.mayUnblock > 0 ? <span title="Through links you haven't confirmed">may unblock {ranked.why.mayUnblock} more</span> : null}
    </div>
  );
}

export function DoneButton({ item, done }: { item: Item; done?: boolean }) {
  const update = useUpdateItem();
  const toast = useToast();
  const isDone = done ?? item.status === 'done';
  return (
    <button type="button" className={`${styles.lead} ${isDone ? styles.leadDone : ''}`}
      aria-label={isDone ? `Mark not done: ${item.title}` : `Mark done: ${item.title}`}
      onClick={() => {
        const status = isDone ? 'open' : 'done';
        update.mutate({ id: item.id, update: { status } }, {
          onSuccess: () => { if (status === 'done') toast(`Done: ${item.title}`, { label: 'Undo', run: () => update.mutate({ id: item.id, update: { status: 'open' } }) }); },
          onError: () => toast('Couldn’t save that. Try again.'),
        });
      }}>
      {isDone ? <Icon name="check" size={15} /> : null}
    </button>
  );
}

export function ItemRow({ item, ranked, actions, done, showReason }: {
  item: Item; ranked?: RankedItem | undefined; actions?: ReactNode; done?: boolean; showReason?: boolean;
}) {
  const open = useOpenItem();
  const isDone = done ?? item.status !== 'open';
  return (
    <li className={`${styles.row} ${isDone ? styles.isDone : ''}`}>
      {item.status === 'dropped' ? <span className={styles.dropped} title="Dropped">–</span> : <DoneButton item={item} done={isDone} />}
      <div className={styles.body}>
        <button type="button" className={styles.title} onClick={() => open(item.id)}>{item.title}</button>
        {showReason && ranked ? <div className={styles.reason}>{ranked.reason}</div> : null}
        <ItemMeta item={item} ranked={ranked} />
      </div>
      <div className={styles.acts}>{actions}</div>
    </li>
  );
}
