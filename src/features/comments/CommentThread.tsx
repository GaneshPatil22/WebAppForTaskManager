import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Comment, CommentTarget } from '../../api/types';
import { useComments, useDeleteComment, useToday, useUpdateComment } from '../../api/queries';
import { useCommentOutbox, useServices } from '../../app/services';
import { MAX_COMMENT_CHARS, sameTarget } from '../../outbox/comments';
import { Icon } from '../../ui/Icon';
import { QueryProblem, Skeleton, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { dayKey, daysBetween, relativeDay, shortDay, wallClock } from '../../domain/time';
import styles from './comments.module.css';

/**
 * Your own notes on an item, goal or commitment, oldest first, as a
 * conversation reads. Brain never reads them and they are never sent to a
 * model. A new one is written to this device first (the comment outbox),
 * so it is not lost offline; it joins the list once the server has it.
 */
export function CommentThread({ target, title = 'Comments', placeholder = 'Add a note for yourself…', empty, big = false }: {
  target: CommentTarget; title?: string; placeholder?: string; empty?: string; big?: boolean;
}) {
  const list = useComments(target);
  const pending = useCommentOutbox().filter((e) => sameTarget(e.target, target));
  const { comments: outbox } = useServices();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const shown = list.data ?? [];
  // Sent but not yet back in the list: shown once, from the server's copy.
  const waiting = pending.filter((p) => !shown.some((c) => c.id === p.id));
  const count = shown.length + waiting.length;
  const tooLong = [...text].length > MAX_COMMENT_CHARS;

  async function add(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || tooLong || saving) return;
    setSaving(true);
    try { await outbox.enqueue(target, body); setText(''); } finally { setSaving(false); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); }
  };

  return (
    <section className={styles.thread} aria-label={title}>
      <div className={styles.head}>
        <h3>{title}{count ? <span className={styles.count}>{count}</span> : null}</h3>
        <span className="sub">Only you see these. Brain never reads them.</span>
      </div>
      {list.error ? <QueryProblem error={list.error} what={title.toLowerCase()} onRetry={() => void list.refetch()} /> : null}
      {/* What waits on this device shows even when the list can't load. */}
      {!list.data && !list.error ? <Skeleton rows={1} />
        : count ? (
          <ol className={styles.list}>
            {shown.map((c) => <CommentRow key={c.id} c={c} target={target} />)}
            {waiting.map((p) => (
              <li key={p.id} className={styles.row}>
                <p className={styles.body}>{p.body}</p>
                <div className={styles.meta}>
                  {p.state === 'rejected' ? (
                    <><span className="chip danger">Not saved: {p.lastError ?? 'refused'}</span>
                      <button type="button" className="link-btn" onClick={() => void outbox.discard(p.id)}>Discard</button></>
                  ) : <span>Saved on this device, sending…</span>}
                </div>
              </li>
            ))}
          </ol>
        ) : empty ? <p className="sub">{empty}</p> : null}
      <form className={styles.compose} onSubmit={add}>
        <textarea className={`input ${big ? styles.bigArea : ''}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={placeholder} aria-label={`Add to ${title.toLowerCase()}`} rows={big ? 3 : 2} />
        <div className={styles.composeBar}>
          {tooLong ? <span className={styles.err}>At most {MAX_COMMENT_CHARS.toLocaleString()} characters.</span> : <span className="sub">⌘ Enter</span>}
          <button type="submit" className="btn sm primary" disabled={!text.trim() || tooLong || saving}>Add</button>
        </div>
      </form>
    </section>
  );
}

function CommentRow({ c, target }: { c: Comment; target: CommentTarget }) {
  const { tz, today } = useToday();
  const update = useUpdateComment(target);
  const del = useDeleteComment(target);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [confirming, setConfirming] = useState(false);
  const at = new Date(c.createdAt);
  const day = dayKey(at, tz);
  const w = wallClock(at, tz);
  const when = `${Math.abs(daysBetween(day, today)) <= 1 ? relativeDay(day, today) : shortDay(day)}, ${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;

  if (editing) {
    return (
      <li className={styles.row}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || body === c.body) { setEditing(false); return; }
          update.mutate({ id: c.id, body }, { onSuccess: () => setEditing(false), onError: (er) => toast(errorText(er)) });
        }}>
          <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit comment" autoFocus rows={3} />
          <div className={styles.composeBar}>
            <span />
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn sm quiet" onClick={() => { setDraft(c.body); setEditing(false); }}>Cancel</button>
              <button type="submit" className="btn sm primary" disabled={!draft.trim() || [...draft].length > MAX_COMMENT_CHARS || update.isPending}>Save</button>
            </span>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className={styles.row}>
      <p className={styles.body}>{c.body}</p>
      <div className={styles.meta}>
        <span>{when}{c.updatedAt !== c.createdAt ? ' · edited' : ''}</span>
        <span className="grow" />
        {confirming ? (
          <>
            <button type="button" className="link-btn" style={{ color: 'var(--danger)' }}
              onClick={() => del.mutate(c.id, { onError: (er) => toast(errorText(er)) })}>Delete</button>
            <button type="button" className="link-btn" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className="icon-btn" aria-label="Edit comment" onClick={() => setEditing(true)}><Icon name="edit" size={13} /></button>
            <button type="button" className="icon-btn" aria-label="Delete comment" onClick={() => setConfirming(true)}><Icon name="trash" size={13} /></button>
          </>
        )}
      </div>
    </li>
  );
}
