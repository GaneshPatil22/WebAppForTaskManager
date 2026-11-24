import { useMemo, useState } from 'react';
import { ITEM_TYPES, type ItemStatus, type ItemType } from '../../api/types';
import { useItems } from '../../api/queries';
import { QueryProblem, Skeleton } from '../../ui/components';
import { TYPE_LABEL } from '../../domain/labels';
import { ItemRow } from './ItemRow';
import styles from './items.module.css';

/**
 * Every item, open or closed, in the order they were captured (newest
 * first). Not a ranking: Today has Brain's order. Filters only.
 */
export function ItemsPage() {
  const items = useItems();
  const [status, setStatus] = useState<ItemStatus>('open');
  const [type, setType] = useState<ItemType | ''>('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => [...(items.data ?? [])].reverse().filter((i) =>
    i.status === status && (!type || i.type.value === type) && (!q || i.title.toLowerCase().includes(q.toLowerCase())),
  ), [items.data, status, type, q]);
  const count = (s: ItemStatus) => (items.data ?? []).filter((i) => i.status === s).length;

  return (
    <>
      <div className="page-head"><div className="grow"><h1>All items</h1><p>Everything Brain made from your captures, newest first. Tap one to correct what Brain guessed.</p></div></div>
      <div className={styles.toolbar}>
        <div className="seg" role="tablist" aria-label="Status">
          {(['open', 'done', 'dropped'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s[0]!.toUpperCase() + s.slice(1)} {items.data ? count(s) : ''}</button>
          ))}
        </div>
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as ItemType | '')} aria-label="Type">
          <option value="">All types</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <input className={`input ${styles.search}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
      </div>
      {items.error ? <QueryProblem error={items.error} what="items" onRetry={() => void items.refetch()} /> : !items.data ? <Skeleton rows={6} /> : rows.length ? (
        <div className="card" style={{ padding: '4px 16px' }}>{rows.map((i) => <ItemRow key={i.id} item={i} showType />)}</div>
      ) : <p className="empty">Nothing here.</p>}
    </>
  );
}
