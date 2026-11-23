import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '../../ui/Dialog';
import { QueryProblem } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { isApiError } from '../../api/client';
import {
  CATEGORIES, EFFORTS, ITEM_STATUSES, ITEM_TYPES,
  type Category, type Effort, type Item, type ItemStatus, type ItemType, type ItemUpdate, type Span, type EdgeKind,
} from '../../api/types';
import {
  useCaptures, useConfirmEdge, useCreateEdge, useEdges, useGoals, useItemsById, useRejectEdge, useToday, useUpdateItem,
} from '../../api/queries';
import { CATEGORY_LABEL, EFFORT_SHORT, TYPE_LABEL, confidenceWord, decidedByLabel } from '../../domain/labels';
import { fromLocalInput, toLocalInput } from '../../domain/time';
import styles from './items.module.css';

export function ItemEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const byId = useItemsById();
  const item = id ? byId.get(id) : undefined;
  return (
    <Dialog open={!!id} onClose={onClose} title={item ? 'Edit item' : 'Item'} wide>
      {item ? <EditorBody key={item.id + item.updatedAt} item={item} onClose={onClose} /> : <p className="muted">This item isn’t loaded.</p>}
    </Dialog>
  );
}

function Who({ d, has }: { d: Item['type']['decidedBy']; has: boolean }) {
  if (!has) return <span className="chip suggested">Brain didn’t decide</span>;
  const l = decidedByLabel(d);
  return <span className={`chip ${l.suggested ? 'suggested' : 'accent'}`}>{l.text}</span>;
}

function EditorBody({ item, onClose }: { item: Item; onClose: () => void }) {
  const { tz } = useToday();
  const goals = useGoals();
  const update = useUpdateItem();
  const toast = useToast();
  const captures = useCaptures();
  const capture = captures.data?.find((c) => c.id === item.captureId);

  const [title, setTitle] = useState(item.title);
  const [type, setType] = useState<ItemType | ''>(item.type.value ?? '');
  const [effort, setEffort] = useState<Effort | ''>(item.effort.value ?? '');
  const [due, setDue] = useState(item.dueAt.value ? toLocalInput(item.dueAt.value, tz) : '');
  const [goalId, setGoalId] = useState(item.goal.value ?? '');
  const [category, setCategory] = useState<Category | ''>(item.category.value ?? '');
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [error, setError] = useState<string | null>(null);

  function changes(): ItemUpdate {
    const u: ItemUpdate = {};
    if (title.trim() && title.trim() !== item.title) u.title = title.trim();
    if (type && type !== item.type.value) u.type = type;
    if (effort && effort !== item.effort.value) u.effort = effort;
    const dueIso = due ? fromLocalInput(due, tz) : null;
    if (dueIso && dueIso !== item.dueAt.value) u.dueAt = dueIso;
    if (goalId && goalId !== item.goal.value) u.goalId = goalId;
    if (category && category !== item.category.value) u.category = category;
    if (status !== item.status) u.status = status;
    return u;
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const u = changes();
    if (!Object.keys(u).length) { onClose(); return; }
    setError(null);
    update.mutate({ id: item.id, update: u }, {
      onSuccess: () => { toast('Saved. Brain learns from your changes.'); onClose(); },
      onError: (err) => setError(isApiError(err) && err.kind === 'notImplemented'
        ? 'The server can’t save edits yet (a later server step). Nothing was changed.'
        : isApiError(err) ? err.message : 'Couldn’t save.'),
    });
  }

  const spans: Span[] = [item.type.evidence, item.effort.evidence, item.dueAt.evidence].filter((s): s is Span => !!s);

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {capture ? (
        <div className="field">
          <span>Your capture {spans.length ? '· highlighted words are where Brain read things' : ''}</span>
          <div className={styles.capture}><Highlighted text={capture.text} spans={spans} /></div>
        </div>
      ) : null}
      <label className="field"><span>Title</span>
        <input className="input" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div className={styles.grid}>
        <label className="field"><span>Type <Who d={item.type.decidedBy} has={!!item.type.value} /></span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            {!item.type.value ? <option value="">Not sure yet</option> : null}
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="field"><span>Effort <Who d={item.effort.decidedBy} has={!!item.effort.value} /></span>
          <select className="input" value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
            {!item.effort.value ? <option value="">Unknown (scored as medium)</option> : null}
            {EFFORTS.filter((x) => x !== 'unknown').map((x) => <option key={x} value={x}>{EFFORT_SHORT[x]}</option>)}
          </select>
        </label>
        <label className="field"><span>Due <Who d={item.dueAt.decidedBy} has={!!item.dueAt.value} /></span>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="field"><span>Goal <Who d={item.goal.decidedBy} has={!!item.goal.value} /></span>
          <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            {!item.goal.value ? <option value="">No goal</option> : null}
            {(goals.data ?? []).filter((g) => g.status === 'active' || g.id === item.goal.value).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
        <label className="field"><span>Category <Who d={item.category.decidedBy} has={!!item.category.value} /></span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {!item.category.value ? <option value="">None</option> : null}
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="field"><span>Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s === 'open' ? 'Open' : s === 'done' ? 'Done' : 'Dropped'}</option>)}
          </select>
        </label>
      </div>
      <p className="sub">Clearing a value (like removing a due date) isn’t supported by the server in v1.</p>

      <Links item={item} />

      {error ? <div className="banner danger">{error}</div> : null}
      <div className={styles.footer}>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  // Spans are UTF-16 offsets (dataset schema), which is what JS strings use.
  const sorted = [...spans].filter((s) => s.end > s.start && s.end <= text.length).sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let at = 0;
  sorted.forEach((s, i) => {
    if (s.start < at) return;
    out.push(text.slice(at, s.start), <mark key={i}>{text.slice(s.start, s.end)}</mark>);
    at = s.end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

type LinkChoice = 'blocks' | 'blockedBy' | 'relates' | 'duplicate';

function Links({ item }: { item: Item }) {
  const edges = useEdges();
  const byId = useItemsById();
  const confirm = useConfirmEdge();
  const reject = useRejectEdge();
  const create = useCreateEdge();
  const [choice, setChoice] = useState<LinkChoice>('blocks');
  const [other, setOther] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mine = useMemo(() => (edges.data ?? []).filter((e) => e.kind !== 'serves' && (e.from === item.id || e.to === item.id)), [edges.data, item.id]);
  const candidates = useMemo(() => [...byId.values()].filter((i) => i.id !== item.id && i.status === 'open'), [byId, item.id]);

  useEffect(() => setErr(null), [choice, other]);

  if (edges.error) return <QueryProblem error={edges.error} what="links" />;

  const add = () => {
    if (!other) return;
    const kind: EdgeKind = choice === 'blockedBy' ? 'blocks' : choice;
    const [from, to] = choice === 'blockedBy' ? [other, item.id] : [item.id, other];
    create.mutate({ from, to, kind }, {
      onSuccess: () => setOther(''),
      onError: (e) => setErr(isApiError(e) && e.code === 'cycle' ? 'That would make a loop: each would be waiting on the other. Brain refuses cycles.' : isApiError(e) ? e.message : 'Couldn’t link.'),
    });
  };

  return (
    <div className="field">
      <span>Links</span>
      {mine.length ? (
        <ul className={styles.links}>
          {mine.map((e) => {
            const out = e.from === item.id;
            const o = byId.get(out ? e.to : e.from);
            const phrase = e.kind === 'blocks' ? (out ? 'Blocks' : 'Blocked by') : e.kind === 'duplicate' ? 'Duplicate of' : 'Relates to';
            return (
              <li key={e.id}>
                <span>
                  <b>{phrase}</b> {o?.title ?? 'an item'}
                  {!e.confirmed ? <span className="chip suggested" style={{ marginLeft: 6 }}>{confidenceWord(e.confidence)} · suggested</span> : null}
                </span>
                {!e.confirmed ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn sm primary" onClick={() => confirm.mutate(e.id)}>Confirm</button>
                    <button type="button" className="btn sm" onClick={() => reject.mutate(e.id)}>Dismiss</button>
                  </span>
                ) : <span className="muted" style={{ fontSize: 12.5 }}>Confirmed</span>}
              </li>
            );
          })}
        </ul>
      ) : <p className="sub">No links yet.</p>}
      <div className={styles.linkForm}>
        <select className="input" value={choice} onChange={(e) => setChoice(e.target.value as LinkChoice)} aria-label="Link kind">
          <option value="blocks">This blocks…</option>
          <option value="blockedBy">Blocked by…</option>
          <option value="relates">Relates to…</option>
          <option value="duplicate">Duplicate of…</option>
        </select>
        <select className="input" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Other item">
          <option value="">Pick an item</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button type="button" className="btn" onClick={add} disabled={!other || create.isPending}>Link</button>
      </div>
      {err ? <div className="banner danger">{err}</div> : null}
    </div>
  );
}
