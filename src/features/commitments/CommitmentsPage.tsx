import { useState, type FormEvent } from 'react';
import { COMMITMENT_KINDS, RULE_KINDS, WEEKDAYS, CATEGORIES, type Category, type Commitment, type CommitmentKind, type CommitmentUpdate, type Rule, type RuleKind, type Weekday } from '../../api/types';
import { useCommitments, useCreateCommitment, useDeleteCommitment, useGoals, useToday, useUpdateCommitment } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { CommentThread } from '../comments/CommentThread';
import { QueryProblem, Skeleton, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { CATEGORY_LABEL, KIND_HINT, KIND_LABEL, RULE_LABEL, WEEKDAY_LABEL } from '../../domain/labels';
import { fmtMinutes, shortDay, ordinal } from '../../domain/time';
import { KIND_ICON } from './OccurrenceRow';
import styles from './commitments.module.css';

const PLURAL: Record<CommitmentKind, string> = { habit: 'Habits', ritual: 'Rituals', payment: 'Payments', block: 'Time blocks' };

/**
 * Standing decisions: things you committed to once, that recur. They are
 * scheduled, never ranked. Only the rule is stored; the server works out
 * the days. Amounts in a note are just text: nothing is ever added up.
 */
export function CommitmentsPage() {
  const list = useCommitments();
  const [editing, setEditing] = useState<Commitment | 'new' | null>(null);

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Commitments</h1><p>Habits, rituals, payments and time blocks. Decided once; they show up on their days.</p></div>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={14} />New commitment</button>
      </div>
      {list.error ? <QueryProblem error={list.error} what="commitments" onRetry={() => void list.refetch()} /> : !list.data ? <Skeleton /> : !list.data.length ? (
        <div className="card">
          <p><b>No commitments yet.</b></p>
          <p className="sub" style={{ marginTop: 4 }}>Add the things you do on a schedule: read 10 pages every day, a review every Sunday, rent on the 4th. They’ll appear on Today, apart from your captured work.</p>
        </div>
      ) : COMMITMENT_KINDS.map((k) => {
        const rows = list.data!.filter((c) => c.kind === k);
        if (!rows.length) return null;
        return (
          <section key={k} className={styles.kindGroup}>
            <div className="section-head" style={{ marginTop: 0 }}><h2>{PLURAL[k]}</h2></div>
            <ul>{rows.map((c) => <CommitmentItem key={c.id} c={c} onEdit={() => setEditing(c)} />)}</ul>
          </section>
        );
      })}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New commitment' : 'Edit commitment'}>
        {editing === 'new' ? <CommitmentForm c={undefined} onDone={() => setEditing(null)} />
          : editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <CommitmentForm c={editing} onDone={() => setEditing(null)} />
              <CommentThread target={{ commitmentId: editing.id }} />
            </div>
          ) : null}
      </Dialog>
    </>
  );
}

function CommitmentItem({ c, onEdit }: { c: Commitment; onEdit: () => void }) {
  const { today } = useToday();
  const update = useUpdateCommitment();
  const toast = useToast();
  return (
    <li className={`${styles.cRow} ${c.paused ? styles.paused : ''}`}>
      <span className={styles.cIcon}><Icon name={KIND_ICON[c.kind]} size={16} /></span>
      <button type="button" className={styles.cMain} style={{ all: 'unset', flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={onEdit}>
        <span className={styles.cTitle}>{c.title}{c.note ? <span className="chip sched">{c.note}</span> : null}{c.paused ? <span className="chip">Paused</span> : null}</span>
        <span className={styles.cMeta}>
          {c.ruleText}{c.minutes ? ` · ${fmtMinutes(c.minutes)}` : ''}
          {c.kind === 'habit' && c.streak ? ` · ${c.streak}-day streak` : ''}
          {!c.paused && c.nextOn && c.rule.kind !== 'daily' ? ` · next ${c.nextOn === today ? 'today' : shortDay(c.nextOn)}` : ''}
          {c.endOn ? ` · until ${shortDay(c.endOn)}` : ''}
        </span>
      </button>
      <button type="button" className="btn sm quiet" disabled={update.isPending}
        onClick={() => update.mutate({ id: c.id, update: { paused: !c.paused } }, { onSuccess: () => toast(c.paused ? 'Resumed.' : 'Paused. Paused days are not missed days.'), onError: (e) => toast(errorText(e)) })}>
        {c.paused ? 'Resume' : 'Pause'}
      </button>
    </li>
  );
}

interface Draft {
  title: string; kind: CommitmentKind; ruleKind: RuleKind; weekday: Weekday; day: number; n: number;
  minutes: string; note: string; category: Category | ''; goalId: string; startOn: string; endOn: string;
}

function toRule(d: Draft): Rule {
  switch (d.ruleKind) {
    case 'daily': return { kind: 'daily' };
    case 'weeklyOn': return { kind: 'weeklyOn', weekday: d.weekday };
    case 'monthlyOnDay': return { kind: 'monthlyOnDay', day: d.day };
    default: return { kind: d.ruleKind, n: d.n, weekday: d.weekday };
  }
}

const ruleKey = (r: Rule) => `${r.kind}|${r.weekday ?? ''}|${r.day ?? ''}|${r.n ?? ''}`;

function CommitmentForm({ c, onDone }: { c?: Commitment | undefined; onDone: () => void }) {
  const { today } = useToday();
  const goals = useGoals();
  const create = useCreateCommitment();
  const update = useUpdateCommitment();
  const remove = useDeleteCommitment();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(() => ({
    title: c?.title ?? '', kind: c?.kind ?? 'habit', ruleKind: c?.rule.kind ?? 'daily',
    weekday: c?.rule.weekday ?? 'sunday', day: c?.rule.day ?? 1, n: c?.rule.n ?? 1,
    minutes: c ? String(c.minutes) : '15', note: c?.note ?? '', category: c?.category ?? '', goalId: c?.goalId ?? '',
    startOn: c?.startOn ?? today, endOn: c?.endOn ?? '',
  }));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const minutes = Math.max(0, Math.min(1440, Math.round(Number(d.minutes) || 0)));
  const activeGoals = (goals.data ?? []).filter((g) => g.status === 'active' || g.id === c?.goalId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const onError = (x: unknown) => setErr(errorText(x, 'Couldn’t save.'));
    if (!c) {
      create.mutate({
        title: d.title.trim(), kind: d.kind, rule: toRule(d), minutes, startOn: d.startOn, paused: false,
        ...(d.note.trim() ? { note: d.note.trim() } : {}), ...(d.category ? { category: d.category } : {}),
        ...(d.goalId ? { goalId: d.goalId } : {}), ...(d.endOn ? { endOn: d.endOn } : {}),
      }, { onSuccess: () => { toast('Committed. It shows up on its days.'); onDone(); }, onError });
      return;
    }
    const u: CommitmentUpdate = {};
    const clear: NonNullable<CommitmentUpdate['clear']> = [];
    if (d.title.trim() !== c.title) u.title = d.title.trim();
    if (d.kind !== c.kind) u.kind = d.kind;
    if (ruleKey(toRule(d)) !== ruleKey(c.rule)) u.rule = toRule(d);
    if (minutes !== c.minutes) u.minutes = minutes;
    if (d.startOn !== c.startOn) u.startOn = d.startOn;
    if (d.note.trim() !== (c.note ?? '')) { if (d.note.trim()) u.note = d.note.trim(); else clear.push('note'); }
    if (d.category !== (c.category ?? '')) { if (d.category) u.category = d.category; else clear.push('category'); }
    if (d.goalId !== (c.goalId ?? '')) { if (d.goalId) u.goalId = d.goalId; else clear.push('goalId'); }
    if (d.endOn !== (c.endOn ?? '')) { if (d.endOn) u.endOn = d.endOn; else clear.push('endOn'); }
    if (clear.length) u.clear = clear;
    if (!Object.keys(u).length) { onDone(); return; }
    update.mutate({ id: c.id, update: u }, { onSuccess: () => { toast('Saved.'); onDone(); }, onError });
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="field"><span>What</span>
        <input className="input" autoFocus={!c} required maxLength={200} value={d.title} placeholder="Read 10 pages" onChange={(e) => set('title', e.target.value)} />
      </label>
      <div className="field">
        <span>Kind</span>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {COMMITMENT_KINDS.map((k) => <button key={k} type="button" aria-pressed={d.kind === k} onClick={() => set('kind', k)}>{KIND_LABEL[k]}</button>)}
        </div>
        <p className="sub">{KIND_HINT[d.kind]}</p>
      </div>
      <div className="field">
        <span>When</span>
        <div className={styles.ruleRow}>
          <select className="input" value={d.ruleKind} onChange={(e) => set('ruleKind', e.target.value as RuleKind)} aria-label="Repeats">
            {RULE_KINDS.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
          </select>
          {d.ruleKind === 'monthlyOnDay' ? (
            <select className="input" value={d.day} onChange={(e) => set('day', Number(e.target.value))} aria-label="Day of month">
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{ordinal(i + 1)}{i + 1 >= 29 ? ' (or the last day)' : ''}</option>)}
            </select>
          ) : null}
          {d.ruleKind === 'monthlyOnNthWeekday' || d.ruleKind === 'quarterlyOnNthWeekday' ? (
            <select className="input" value={d.n} onChange={(e) => set('n', Number(e.target.value))} aria-label="Which one">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{['First', 'Second', 'Third', 'Fourth', 'Fifth'][n - 1]}</option>)}
            </select>
          ) : null}
          {d.ruleKind !== 'daily' && d.ruleKind !== 'monthlyOnDay' ? (
            <select className="input" value={d.weekday} onChange={(e) => set('weekday', e.target.value as Weekday)} aria-label="Weekday">
              {WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_LABEL[w]}</option>)}
            </select>
          ) : null}
        </div>
        {d.ruleKind === 'quarterlyOnNthWeekday' ? <p className="sub">In January, April, July and October.</p> : null}
        {(d.ruleKind === 'monthlyOnNthWeekday' || d.ruleKind === 'quarterlyOnNthWeekday') && d.n === 5 ? <p className="sub">Months without a fifth one are skipped.</p> : null}
      </div>
      <div className="form-grid">
        <label className="field"><span>Takes (minutes)</span>
          <input className="input" type="number" min={0} max={1440} value={d.minutes} onChange={(e) => set('minutes', e.target.value)} />
        </label>
        <label className="field"><span>Note</span>
          <input className="input" maxLength={200} value={d.note} placeholder={d.kind === 'payment' ? '22k' : 'Optional'} onChange={(e) => set('note', e.target.value)} />
        </label>
      </div>
      <details>
        <summary className="sub" style={{ cursor: 'pointer' }}>More: goal, category, start and end</summary>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <label className="field"><span>Serves goal</span>
            <select className="input" value={d.goalId} onChange={(e) => set('goalId', e.target.value)}>
              <option value="">None</option>
              {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.title}{g.periodText ? ` · ${g.periodText}` : ''}</option>)}
            </select>
          </label>
          <label className="field"><span>Category</span>
            <select className="input" value={d.category} onChange={(e) => set('category', e.target.value as Category)}>
              <option value="">None</option>
              {CATEGORIES.map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}
            </select>
          </label>
          <label className="field"><span>Starts</span><input className="input" type="date" required value={d.startOn} onChange={(e) => set('startOn', e.target.value)} /></label>
          <label className="field"><span>Ends (optional)</span><input className="input" type="date" value={d.endOn} min={d.startOn} onChange={(e) => set('endOn', e.target.value)} /></label>
        </div>
      </details>
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="form-actions">
        {c ? (confirmDelete ? (
          <>
            <span className="sub" style={{ alignSelf: 'center' }}>Ends it today. Past days stay in your reviews.</span>
            <button type="button" className="btn danger" onClick={() => remove.mutate(c.id, { onSuccess: () => { toast('Deleted. Its history stays in your reviews.'); onDone(); }, onError: (x) => setErr(errorText(x)) })}>Delete</button>
          </>
        ) : <button type="button" className="btn quiet" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} />Delete</button>) : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={!d.title.trim() || create.isPending || update.isPending}>{c ? 'Save' : 'Commit'}</button>
      </div>
    </form>
  );
}
