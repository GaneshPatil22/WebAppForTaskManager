import type { ReactNode } from 'react';
import type { Item } from '../../api/types';
import { useGoalsById, useToday } from '../../api/queries';
import { useOpenItem } from '../../app/itemSheet';
import { Val } from '../../ui/components';
import { EFFORT_LABEL, TYPE_LABEL } from '../../domain/labels';
import { dueLabel } from '../../domain/time';
import { SizeChip } from './SizeChip';
import styles from './items.module.css';

/**
 * One line of facts about an item. Every classified value is marked when it
 * is Brain's guess (dashed, amber) rather than yours (plain). Nothing is
 * shown that Brain didn't decide.
 */
export function ItemMeta({ item, showType = false, showSize = true }: { item: Item; showType?: boolean; showSize?: boolean }) {
  const { now, tz } = useToday();
  const goals = useGoalsById();
  const parts: ReactNode[] = [];
  if (showType && item.type.value) parts.push(<Val key="t" by={item.type.decidedBy}>{TYPE_LABEL[item.type.value]}</Val>);
  if (showSize && item.effort.value && item.effort.value !== 'unknown') parts.push(<Val key="e" by={item.effort.decidedBy}>{EFFORT_LABEL[item.effort.value]}</Val>);
  if (item.dueAt.value) {
    const d = dueLabel(item.dueAt.value, now, tz);
    parts.push(<span key="d" className={d.urgent && item.status === 'open' ? styles.urgent : undefined}><Val by={item.dueAt.decidedBy}>{d.text}</Val></span>);
  }
  const goal = item.goal.value ? goals.get(item.goal.value) : undefined;
  if (goal) parts.push(<Val key="g" by={item.goal.decidedBy}>{goal.title}</Val>);
  if (!parts.length) return null;
  return <span className={styles.meta}>{parts.flatMap((p, i) => (i ? [<span key={`s${i}`} aria-hidden> · </span>, p] : [p]))}</span>;
}

/**
 * A tappable item: opens the editor. `lead` and `actions` are the caller's.
 * An open item's size is a chip you can change in one tap.
 */
export function ItemRow({ item, lead, actions, reason, showType }: {
  item: Item; lead?: ReactNode; actions?: ReactNode; reason?: string | undefined; showType?: boolean;
}) {
  const open = useOpenItem();
  const closed = item.status !== 'open';
  // Notes and ideas aren't planned, so they get no size unless they have one.
  // A link is "read this": it is planned and has a real duration.
  const sized = !!item.effort.value && item.effort.value !== 'unknown';
  const sizeChip = !closed && (sized || !['note', 'idea'].includes(item.type.value ?? ''));
  return (
    <div className={`${styles.row} ${closed ? styles.closed : ''}`}>
      {lead}
      <button type="button" className={styles.main} onClick={() => open(item.id)}>
        <span className={styles.title}>{item.title}</span>
        <ItemMeta item={item} showType={!!showType} showSize={!sizeChip} />
        {reason ? <span className={styles.reason}>{reason}</span> : null}
      </button>
      {sizeChip ? <SizeChip item={item} /> : null}
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </div>
  );
}
