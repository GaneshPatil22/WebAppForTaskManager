import { useMemo } from 'react';
import type { Capture, Edge, Item } from '../../api/types';
import { useCaptures, useConfirmEdge, useItems, useItemsById, useRejectEdge, useSuggestions, useToday } from '../../api/queries';
import { useOutbox, useServices } from '../../app/services';
import { useOpenItem } from '../../app/itemSheet';
import { openCapture } from '../../app/Shell';
import { Icon } from '../../ui/Icon';
import { QueryProblem, Skeleton, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { confidenceWord, TYPE_LABEL } from '../../domain/labels';
import { dayKey, daysBetween, relativeDay, shortDay } from '../../domain/time';
import { ItemMeta } from '../items/ItemRow';
import { InboxQuestions } from '../questions/Questions';
import type { OutboxEntry } from '../../outbox/store';
import styles from './inbox.module.css';

/**
 * Everything you dumped, newest first, with what Brain made of it.
 * Captures are never edited or deleted. Suggested links and questions
 * appear only when there are some; there is no empty card for either.
 */
export function InboxPage() {
  const caps = useCaptures();
  const outbox = useOutbox();
  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Inbox</h1><p>What you captured and what Brain made of it. Nothing here is ever lost.</p></div>
        <button type="button" className="btn primary" onClick={openCapture}><Icon name="plus" size={14} />Capture</button>
      </div>
      <Waiting rows={outbox} />
      <SuggestedLinks />
      <InboxQuestions />
      {caps.error ? <QueryProblem error={caps.error} what="your captures" onRetry={() => void caps.refetch()} /> : !caps.data ? <Skeleton rows={4} /> : (
        <CaptureList captures={caps.data} />
      )}
    </>
  );
}

/** Captures still on this device: unsent, or refused by the server. */
function Waiting({ rows }: { rows: OutboxEntry[] }) {
  const { outbox } = useServices();
  if (!rows.length) return null;
  return (
    <section className={styles.block}>
      <div className="section-head" style={{ marginTop: 0 }}><h2>On this device</h2><span className="grow" />
        {rows.some((r) => r.state === 'pending') ? <button className="btn sm" onClick={() => outbox.retryNow()}>Send now</button> : null}
      </div>
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.id} className={styles.cap}>
            <p className={styles.text}>{r.text}</p>
            <div className={styles.capMeta}>
              {r.state === 'rejected'
                ? <><span className="chip danger">Refused: {r.lastError ?? 'invalid'}</span><button className="btn sm quiet" onClick={() => void outbox.discard(r.id)}>Discard</button></>
                : <span className="chip">{r.attempts ? `Waiting for Brain · tried ${r.attempts}×` : 'Sending…'}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SuggestedLinks() {
  const s = useSuggestions();
  const byId = useItemsById();
  const confirm = useConfirmEdge();
  const reject = useRejectEdge();
  const toast = useToast();
  const rows = (s.data ?? []).filter((e) => byId.has(e.from) && byId.has(e.to));
  if (!rows.length) return null;
  const phrase = (e: Edge) => (e.kind === 'blocks' ? 'must finish before' : e.kind === 'duplicate' ? 'is the same as' : 'relates to');
  return (
    <section className={styles.block}>
      <div className="section-head" style={{ marginTop: 0 }}><h2>Brain noticed</h2><span className="grow sub">Links count only once you confirm them.</span></div>
      <ul className={styles.list}>
        {rows.map((e) => (
          <li key={e.id} className={styles.suggest}>
            <span><b>{byId.get(e.from)!.title}</b> <span className="muted">{phrase(e)}</span> <b>{byId.get(e.to)!.title}</b></span>
            <span className={styles.suggestActions}>
              <span className="chip guess">{confidenceWord(e.confidence)}</span>
              <button className="btn sm" onClick={() => confirm.mutate(e.id, { onError: (x) => toast(errorText(x)) })}>Confirm</button>
              <button className="btn sm quiet" onClick={() => reject.mutate(e.id)}>Dismiss</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CaptureList({ captures }: { captures: Capture[] }) {
  const items = useItems();
  const { tz, today } = useToday();
  const byCapture = useMemo(() => new Map((items.data ?? []).filter((i) => i.captureId).map((i) => [i.captureId!, i])), [items.data]);
  const groups = useMemo(() => {
    const out = new Map<string, Capture[]>();
    for (const c of [...captures].reverse()) {
      const k = dayKey(new Date(c.capturedAt), tz);
      out.set(k, [...(out.get(k) ?? []), c]);
    }
    return [...out.entries()];
  }, [captures, tz]);
  if (!captures.length) return <p className="empty">Nothing captured yet. Press / anywhere, or the + button, and dump what’s on your mind.</p>;
  return (
    <>
      {groups.map(([day, rows]) => (
        <section key={day} className={styles.block}>
          <div className="section-head" style={{ marginTop: 0 }}><h2>{Math.abs(daysBetween(day, today)) <= 1 ? relativeDay(day, today) : shortDay(day)}</h2></div>
          <ul className={styles.list}>{rows.map((c) => <CaptureRow key={c.id} c={c} item={byCapture.get(c.id)} />)}</ul>
        </section>
      ))}
    </>
  );
}

function CaptureRow({ c, item }: { c: Capture; item: Item | undefined }) {
  const open = useOpenItem();
  const pending = c.status === 'raw' || c.status === 'enriching';
  return (
    <li className={styles.cap}>
      <p className={styles.text}>{c.text}</p>
      <div className={styles.capMeta}>
        {item ? (
          <button type="button" className={styles.became} onClick={() => open(item.id)}>
            <Icon name="arrowRight" size={13} />
            <span className={styles.becameTitle}>{item.title}</span>
            {item.type.value ? <span className="chip">{TYPE_LABEL[item.type.value]}</span> : null}
            <ItemMeta item={item} />
          </button>
        ) : pending ? <span className="sub"><span className="spin"><Icon name="refresh" size={12} /></span> Brain is organising this…</span>
          : c.status === 'failed' ? <span className="sub">Brain couldn’t organise this yet. It will try again; the capture is safe.</span>
          : <span className="sub">Organised</span>}
      </div>
    </li>
  );
}
