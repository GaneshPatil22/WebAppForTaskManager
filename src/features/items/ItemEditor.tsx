import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Decided, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import {
  CATEGORIES, EFFORTS, ITEM_TYPES,
  type Category, type Effort, type Item, type ItemType, type ItemUpdate, type Span,
} from '../../api/types';
import {
  useCaptures, useConfirmEdge, useCreateEdge, useEdges, useGoals, useItemsById, useRejectEdge, useToday, useUpdateItem,
} from '../../api/queries';
import { CATEGORY_LABEL, EFFORT_SHORT, TYPE_LABEL, confidenceWord } from '../../domain/labels';
import { fromLocalInput, toLocalInput } from '../../domain/time';
import styles from './items.module.css';

export function ItemEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const byId = useItemsById();
  const item = id ? byId.get(id) : undefined;
  return (
    <Dialog open={!!id} onClose={onClose} title={item ? 'Item' : 'Item'} wide>
      {item ? <EditorBody key={item.id + item.updatedAt} item={item} onClose={onClose} /> : <p className="muted">This item isn’t loaded.</p>}
    </Dialog>
  );
}

/**
 * Every field shows who decided it. Changing one sends `decidedBy: user`
 * and the server records a correction against whoever had decided it:
 * that is what Brain learns from.
 */
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
    return u;
  }

  function send(u: ItemUpdate, done: string) {
    setError(null);
    update.mutate({ id: item.id, update: u }, {
      onSuccess: () => { toast(done); onClose(); },
      onError: (err) => setError(errorText(err, 'Couldn’t save.')),
    });
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const u = changes();
    if (!Object.keys(u).length) { onClose(); return; }
    send(u, 'Saved. Brain learns from what you changed.');
  }

  const spans: Span[] = [item.type.evidence, item.effort.evidence, item.dueAt.evidence].filter((s): s is Span => !!s);
  const activeGoals = (goals.data ?? []).filter((g) => g.status === 'active' || g.id === item.goal.value);

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {capture ? (
        <div className="field">
          <span>What you captured{spans.length ? ' · highlighted is where Brain read things' : ''}</span>
          <div className={styles.capture}><Highlighted text={capture.text} spans={spans} /></div>
        </div>
      ) : null}
      <label className="field"><span>Title</span>
        <input className="input" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div className="form-grid">
        <Field label="Type" who={<Decided by={item.type.decidedBy} has={!!item.type.value} />}>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            {!item.type.value ? <option value="">Not decided</option> : null}
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Size" who={<Decided by={item.effort.decidedBy} has={!!item.effort.value && item.effort.value !== 'unknown'} />}>
          <select className="input" value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
            {!item.effort.value ? <option value="">Unknown (counts as medium)</option> : null}
            {EFFORTS.filter((x) => x !== 'unknown' || item.effort.value === 'unknown').map((x) => <option key={x} value={x}>{EFFORT_SHORT[x]}</option>)}
          </select>
        </Field>
        <Field label="Due" who={<Decided by={item.dueAt.decidedBy} has={!!item.dueAt.value} />}>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Goal" who={<Decided by={item.goal.decidedBy} has={!!item.goal.value} />}>
          <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)} disabled={!activeGoals.length}>
            {!item.goal.value ? <option value="">{activeGoals.length ? 'No goal' : 'No goals yet'}</option> : null}
            {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.title}{g.periodText ? ` · ${g.periodText}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Category" who={<Decided by={item.category.decidedBy} has={!!item.category.value} />}>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {!item.category.value ? <option value="">None</option> : null}
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
      </div>
      <p className="sub">Clearing a value, like removing a due date, isn’t supported by the server yet.</p>

      <Links item={item} />

      {error ? <div className="banner danger">{error}</div> : null}
      <div className="form-actions">
        {item.status === 'open' ? (
          <>
            <button type="button" className="btn quiet" onClick={() => send({ status: 'dropped' }, 'Dropped.')}>Drop</button>
            <button type="button" className="btn" onClick={() => send({ status: 'done' }, 'Done.')}>Mark done</button>
          </>
        ) : <button type="button" className="btn" onClick={() => send({ status: 'open' }, 'Reopened.')}>Reopen</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function Field({ label, who, children }: { label: string; who: ReactNode; children: ReactNode }) {
  return <label className="field"><span>{label} {who}</span>{children}</label>;
}

function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  // Spans are UTF-16 offsets (dataset schema), which is what JS strings use.
  const sorted = [...spans].filter((s) => s.end > s.start && s.end <= text.length).sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  sorted.forEach((s, i) => {
    if (s.start < at) return;
    out.push(text.slice(at, s.start), <mark key={i}>{text.slice(s.start, s.end)}</mark>);
    at = s.end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * Links to other items. A suggested link is Brain's proposal: it counts for
 * nothing until you confirm it, and a dismissed one never comes back.
 */
function Links({ item }: { item: Item }) {
  const edges = useEdges();
  const byId = useItemsById();
  const confirm = useConfirmEdge();
  const reject = useRejectEdge();
  const create = useCreateEdge();
  const [choice, setChoice] = useState<'blocks' | 'blockedBy' | 'relates'>('blockedBy');
  const [other, setOther] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mine = useMemo(() => (edges.data ?? []).filter((e) => e.kind !== 'serves' && (e.from === item.id || e.to === item.id)), [edges.data, item.id]);
  const candidates = useMemo(() => [...byId.values()].filter((i) => i.id !== item.id && i.status === 'open'), [byId, item.id]);

  const add = () => {
    if (!other) return;
    const [from, to] = choice === 'blockedBy' ? [other, item.id] : [item.id, other];
    setErr(null);
    create.mutate({ from, to, kind: choice === 'relates' ? 'relates' : 'blocks' }, {
      onSuccess: () => setOther(''),
      onError: (e) => setErr(errorText(e, 'Couldn’t link.')),
    });
  };

  return (
    <div className="field">
      <span>Depends on</span>
      {mine.length ? (
        <ul className={styles.links}>
          {mine.map((e) => {
            const out = e.from === item.id;
            const o = byId.get(out ? e.to : e.from);
            const phrase = e.kind === 'blocks' ? (out ? 'Must finish before' : 'Waits for') : e.kind === 'duplicate' ? 'Same as' : 'Related to';
            return (
              <li key={e.id}>
                <span><b>{phrase}</b> {o?.title ?? 'an item'}</span>
                {!e.confirmed ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="chip guess">{confidenceWord(e.confidence)} · Brain’s guess</span>
                    <button type="button" className="btn sm" onClick={() => confirm.mutate(e.id)}>Confirm</button>
                    <button type="button" className="btn sm quiet" onClick={() => reject.mutate(e.id)}>Dismiss</button>
                  </span>
                ) : <span className="chip yours">You confirmed</span>}
              </li>
            );
          })}
        </ul>
      ) : null}
      {candidates.length ? (
        <div className={styles.addLink}>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)} aria-label="Link kind">
            <option value="blockedBy">Waits for</option>
            <option value="blocks">Must finish before</option>
            <option value="relates">Related to</option>
          </select>
          <select className="input" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Other item">
            <option value="">Choose an item…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button type="button" className="btn" onClick={add} disabled={!other || create.isPending}>Link</button>
        </div>
      ) : null}
      {err ? <div className="banner danger">{err}</div> : null}
    </div>
  );
}
