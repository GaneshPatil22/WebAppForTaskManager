import { useMemo, useState } from 'react';
import type { Capture, Item } from '../../api/types';
import { useCaptures, useItems, useToday, useUpdateItem } from '../../api/queries';
import { useOutbox, useServices } from '../../app/services';
import { useOpenItem } from '../../app/itemSheet';
import { dayKey, relativeDay, wallClock } from '../../domain/time';
import { QueryProblem, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import { ItemMeta } from '../items/ItemRow';
import { QuestionsCard } from '../shared/Questions';
import { SuggestionsCard } from '../shared/Suggestions';
import type { OutboxEntry } from '../../outbox/store';
import styles from './inbox.module.css';

type Filter = 'all' | 'organising' | 'enriched' | 'failed';

export function InboxPage() {
  const captures = useCaptures();
  const items = useItems();
  const outbox = useOutbox();
  const [filter, setFilter] = useState<Filter>('all');

  const byCapture = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items.data ?? []) if (i.captureId) m.set(i.captureId, [...(m.get(i.captureId) ?? []), i]);
    return m;
  }, [items.data]);

  const sent = new Set((captures.data ?? []).map((c) => c.id));
  const unsent = outbox.filter((e) => !sent.has(e.id));
  const list = [...(captures.data ?? [])]
    .filter((c) => filter === 'all' || (filter === 'organising' ? c.status === 'raw' || c.status === 'enriching' : c.status === filter))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id));

  return (
    <>
      <div className="vhead">
        <div className="grow"><h1>Inbox</h1><p>Everything you dumped. Brain sorts it and suggests links; you decide. Captures are never deleted.</p></div>
      </div>

      {unsent.length ? (
        <>
          <h2 className="section-title">On this device</h2>
          <ul className="list" style={{ marginBottom: 22 }}>{unsent.map((e) => <OutboxRow key={e.id} e={e} />)}</ul>
        </>
      ) : null}

      <div className={styles.cards}>
        <QuestionsCard />
        <SuggestionsCard />
      </div>

      <div className={styles.head}>
        <h2 className="section-title" style={{ margin: 0 }}>Captures</h2>
        <div className={styles.filters} role="group" aria-label="Filter captures">
          {([['all', 'All'], ['organising', 'Organising'], ['enriched', 'Organised'], ['failed', 'Retrying']] as const).map(([f, l]) => (
            <button key={f} className={`btn sm ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>
          ))}
        </div>
      </div>
      {captures.error ? <QueryProblem error={captures.error} what="captures" onRetry={() => void captures.refetch()} />
        : captures.isLoading ? <Skeleton rows={5} />
        : list.length ? <ul className="list">{list.map((c) => <CaptureRow key={c.id} c={c} items={byCapture.get(c.id) ?? []} />)}</ul>
        : <ul className="list"><li className="empty">{filter === 'all' ? 'Nothing yet. Use the bar at the top to dump something.' : 'Nothing here.'}</li></ul>}
    </>
  );
}

function when(iso: string, tz: string, today: string): string {
  const k = dayKey(new Date(iso), tz);
  const w = wallClock(new Date(iso), tz);
  return `${relativeDay(k, today)}, ${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

function CaptureRow({ c, items }: { c: Capture; items: Item[] }) {
  const { tz, today } = useToday();
  const open = useOpenItem();
  const update = useUpdateItem();
  const toast = useToast();
  const organising = c.status === 'raw' || c.status === 'enriching';
  return (
    <li className={styles.row}>
      <div className={styles.text}>{c.text}</div>
      <div className="meta">
        <span>{when(c.capturedAt, tz, today)}</span>
        {c.source !== 'text' ? <span className="chip">{c.source}</span> : null}
        {organising ? <><span className="chip accent">Organising…</span><span className="shimmer" /><span className="shimmer" /></> : null}
        {c.status === 'failed' ? <span className="chip danger" title="Brain will try again. Nothing is lost.">Will retry</span> : null}
        {c.status === 'enriched' && !items.length ? <span className="chip">No item</span> : null}
      </div>
      {items.length ? (
        <ul className={styles.items}>
          {items.map((i) => (
            <li key={i.id} className={i.status !== 'open' ? styles.closed : undefined}>
              <div style={{ minWidth: 0 }}>
                <button type="button" className={styles.ititle} onClick={() => open(i.id)}>
                  <Icon name="right" size={13} />{i.title}
                </button>
                <ItemMeta item={i} />
              </div>
              <div className={styles.iacts}>
                <button className="btn sm" onClick={() => open(i.id)}>Edit</button>
                {i.status === 'open' ? (
                  <button className="btn sm" onClick={() => update.mutate({ id: i.id, update: { status: 'dropped' } }, {
                    onSuccess: () => toast('Dropped. The capture is kept.', { label: 'Undo', run: () => update.mutate({ id: i.id, update: { status: 'open' } }) }),
                    onError: () => toast('Couldn’t save that.'),
                  })}>Drop</button>
                ) : <span className="chip">{i.status === 'done' ? 'Done' : 'Dropped'}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function OutboxRow({ e }: { e: OutboxEntry }) {
  const { outbox } = useServices();
  const toast = useToast();
  const waitSec = Math.max(0, Math.round((e.nextAttemptAt - Date.now()) / 1000));
  return (
    <li className={styles.row}>
      <div className={styles.text}>{e.text}</div>
      <div className="meta">
        {e.state === 'rejected' ? (
          <>
            <span className="chip danger">Refused by the server</span>
            <span>{e.lastError}</span>
          </>
        ) : e.attempts === 0 ? <span className="chip accent">Sending…</span> : (
          <>
            <span className="chip danger">Waiting for Brain</span>
            <span>Saved here. Tried {e.attempts} time{e.attempts === 1 ? '' : 's'}{waitSec ? `, next in ${waitSec}s` : ''}.</span>
          </>
        )}
      </div>
      <div className={styles.iacts} style={{ marginTop: 8, justifyContent: 'flex-start' }}>
        {e.state === 'pending' ? <button className="btn sm" onClick={() => outbox.retryNow()}>Retry now</button> : (
          <>
            <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(e.text).then(() => toast('Copied.')); }}>Copy text</button>
            <button className="btn sm danger" onClick={() => { if (confirm('Discard this capture? It never reached the server, so this removes the only copy.')) void outbox.discard(e.id); }}>Discard</button>
          </>
        )}
      </div>
    </li>
  );
}
