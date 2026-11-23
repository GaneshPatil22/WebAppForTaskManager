import { useMemo, useState } from 'react';
import { useItems } from '../../api/queries';
import { ITEM_TYPES, type ItemStatus, type ItemType } from '../../api/types';
import { TYPE_LABEL } from '../../domain/labels';
import { QueryProblem, Skeleton } from '../../ui/components';
import { ItemRow } from './ItemRow';
import styles from './items.module.css';

export function ItemsPage() {
  const items = useItems();
  const [status, setStatus] = useState<ItemStatus | 'all'>('open');
  const [type, setType] = useState<ItemType | 'all' | 'unsure'>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items.data ?? [])
      .filter((i) => status === 'all' || i.status === status)
      .filter((i) => type === 'all' || (type === 'unsure' ? !i.type.value : i.type.value === type))
      .filter((i) => !needle || i.title.toLowerCase().includes(needle))
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [items.data, status, type, q]);

  return (
    <>
      <div className="vhead">
        <div className="grow"><h1>All items</h1><p>Everything Brain has made from your captures. Open one to change what it decided.</p></div>
      </div>
      <div className={styles.toolbar}>
        <input className="input" placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ flex: 1, minWidth: 180 }} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | 'all')} aria-label="Status">
          <option value="open">Open</option><option value="done">Done</option><option value="dropped">Dropped</option><option value="all">All statuses</option>
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as ItemType | 'all' | 'unsure')} aria-label="Type">
          <option value="all">All types</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          <option value="unsure">Type not decided</option>
        </select>
      </div>
      {items.error ? <QueryProblem error={items.error} what="items" onRetry={() => void items.refetch()} />
        : items.isLoading ? <Skeleton rows={6} />
        : rows.length ? <ul className="list">{rows.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
        : <ul className="list"><li className="empty">Nothing matches.</li></ul>}
    </>
  );
}
