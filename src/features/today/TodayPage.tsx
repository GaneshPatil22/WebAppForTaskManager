import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import type { Plan, ScheduledCommitment } from '../../api/types';
import { useDailyPlans, useItems, useItemsById, useJournal, useOccurrences, usePlan, useCommitments, useToday } from '../../api/queries';
import { useServices } from '../../app/services';
import { useToast } from '../../ui/toast';
import { MAX_CAPTURE_CHARS } from '../../outbox/outbox';
import { planned, plannedStore } from '../../local/planned';
import { ItemRow } from '../items/ItemRow';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { ProposalTag, QueryProblem, Skeleton } from '../../ui/components';
import { OccurrenceRow, type OccurrenceView } from '../commitments/OccurrenceRow';
import { JournalEditor } from '../journal/JournalEditor';
import { BigTask, Chooser } from './BigTask';
import { Candidates } from './Candidates';
import { TodayQuestion } from '../questions/Questions';
import { addDaysToKey, dayKey, fmtMinutes, longDay, type DayKey } from '../../domain/time';
import styles from './today.module.css';

/**
 * Today has two halves that must never read as one list:
 * - Committed: scheduled, decided once by you. A checklist. Teal.
 * - Ranked by Brain: captured work in Brain's order. Numbered. Indigo.
 * The big task is the hinge: a daily slot filled from the ranked pile.
 * "Today" is the plan's `day`, which the server computes in your timezone.
 */
export function TodayPage() {
  const plan = usePlan();
  if (plan.error && !plan.data) return <><Head /><QueryProblem error={plan.error} what="today’s plan" onRetry={() => void plan.refetch()} /></>;
  if (!plan.data) return <><Head /><Skeleton rows={4} /></>;
  return <Today plan={plan.data} refreshing={plan.isFetching} onRefresh={() => void plan.refetch()} />;
}

function Head({ children }: { children?: React.ReactNode }) {
  return <div className="page-head">{children ?? <div className="grow"><h1>Today</h1></div>}</div>;
}

const toView = (s: ScheduledCommitment, day: DayKey): OccurrenceView => ({
  commitment: s.commitment,
  day: s.movedFrom ?? day,
  place: day,
  state: s.state,
  movedTo: s.movedTo,
});

function Today({ plan, refreshing, onRefresh }: { plan: Plan; refreshing: boolean; onRefresh: () => void }) {
  const day = plan.day;
  const [planning, setPlanning] = useState(false);
  const views = plan.commitments.map((s) => toView(s, day));
  const owed = views.filter((v) => !v.state && v.place === day);
  const doneN = views.filter((v) => v.state === 'done').length;
  const due = views.filter((v) => v.state !== 'moved' && v.state !== 'skipped').length;

  return (
    <>
      <Head>
        <div className="grow">
          <h1>{longDay(day)}</h1>
          <p>
            {plan.commitments.length
              ? <>{doneN} of {due} commitments done{plan.committedMinutes ? <> · {fmtMinutes(plan.committedMinutes)} still committed</> : null}</>
              : 'No commitments today.'}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setPlanning(true)}><Icon name="arrowRight" size={14} />Plan tomorrow</button>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label="Refresh" title="Refresh">
          <span className={refreshing ? 'spin' : undefined}><Icon name="refresh" size={16} /></span>
        </button>
      </Head>

      <TodayQuestion />

      <div className={styles.grid}>
        <div className={styles.areaBig}><BigTask plan={plan} day={day} /></div>

        <div className={styles.side}>
          <section className={`${styles.areaSched} ${styles.sched}`} aria-label="Committed today">
            <div className={styles.schedHead}>
              <h2><span className={styles.schedDot} />Committed</h2>
              <Link to="/commitments" className="link-btn">Edit</Link>
            </div>
            <p className={styles.schedSub}>Scheduled by you, not ranked.{owed.length ? ` ${owed.length} left.` : ''}</p>
            {views.length ? (
              <ul className={styles.occList}>
                {views.map((v) => <OccurrenceRow key={`${v.commitment.id}|${v.day}`} o={v} today={day} />)}
              </ul>
            ) : (
              <p className="empty">Nothing scheduled. Habits, reviews and payments live in <Link to="/commitments">Commitments</Link>.</p>
            )}
          </section>

          <section className={styles.areaJournal} aria-label="Journal">
            <div className="section-head" style={{ marginTop: 22 }}><h2>Journal</h2><span className="grow" /><Link to="/journal" className="link-btn">All entries</Link></div>
            <TodayJournal day={day} />
          </section>
        </div>

        <div className={styles.areaRanked}><Candidates plan={plan} exclude={plan.bigTask?.itemId ?? plan.next?.item.id} /></div>
      </div>

      <Dialog open={planning} onClose={() => setPlanning(false)} title="Plan tomorrow" wide>
        <PlanTomorrow plan={plan} />
      </Dialog>
    </>
  );
}

function TodayJournal({ day }: { day: DayKey }) {
  const j = useJournal({ from: day, through: day });
  if (j.error) return <QueryProblem error={j.error} what="the journal" />;
  if (!j.data) return <Skeleton rows={1} />;
  return <JournalEditor day={day} entry={j.data[0]} />;
}

/**
 * The evening ritual: see what tomorrow already holds, then pick its big
 * task. Brain's current pick is the proposal; choosing another is a swap.
 */
function PlanTomorrow({ plan }: { plan: Plan }) {
  const tomorrow = addDaysToKey(plan.day, 1);
  const range = { from: tomorrow, through: tomorrow };
  const occ = useOccurrences(range);
  const commitments = useCommitments();
  const dp = useDailyPlans(range);
  const byId = useItemsById();
  const [choosing, setChoosing] = useState(false);
  const cById = new Map((commitments.data ?? []).map((c) => [c.id, c]));
  const views: OccurrenceView[] = (occ.data ?? [])
    .filter((o) => (o.movedTo ?? o.day) === tomorrow)
    .flatMap((o) => { const c = cById.get(o.commitmentId); return c ? [{ commitment: c, day: o.day, place: tomorrow, state: o.state, movedTo: o.movedTo }] : []; });
  const minutes = views.filter((v) => !v.state).reduce((n, v) => n + v.commitment.minutes, 0);
  const confirmed = dp.data?.[0];
  const chosen = confirmed ? byId.get(confirmed.itemId) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section>
        <h3 className={styles.dlgH}>{longDay(tomorrow)}: already committed</h3>
        {occ.error || commitments.error ? <QueryProblem error={occ.error ?? commitments.error} what="tomorrow’s commitments" /> : !occ.data ? <Skeleton rows={2} /> : views.length ? (
          <>
            <p className="sub">{views.length} commitments{minutes ? `, about ${fmtMinutes(minutes)}` : ''}. Shown so you know how much room the day has; nothing here is subtracted for you.</p>
            <ul className={styles.tomorrowList}>
              {views.map((v) => <OccurrenceRow key={`${v.commitment.id}|${v.day}`} o={v} today={plan.day} compact />)}
            </ul>
          </>
        ) : <p className="sub">Nothing scheduled.</p>}
      </section>
      <AddForTomorrow plan={plan} tomorrow={tomorrow} />
      <section>
        <h3 className={styles.dlgH}>Tomorrow’s big task</h3>
        {confirmed ? (
          <div className={styles.tomorrowPick}>
            <div><b>{chosen?.title ?? 'An item'}</b><p className="sub">{confirmed.swapped ? 'You chose this over Brain’s pick.' : 'Brain’s pick, confirmed by you.'}</p></div>
            <button type="button" className="btn sm" onClick={() => setChoosing(true)}>Change</button>
          </div>
        ) : plan.next ? (
          <div className={`${styles.tomorrowPick} ${styles.bigProposed}`}>
            <div><ProposalTag /><p style={{ marginTop: 6 }}><b>{plan.next.item.title}</b></p><p className="sub">{plan.next.reason}</p></div>
            <button type="button" className="btn sm primary" onClick={() => setChoosing(true)}>Choose</button>
          </div>
        ) : <p className="sub">Nothing to propose yet.</p>}
      </section>
      <Chooser open={choosing} onClose={() => setChoosing(false)} day={tomorrow} plan={plan} current={confirmed?.itemId} title="Choose tomorrow’s big task" />
    </div>
  );
}

/**
 * Add things for tomorrow. Each one is an ordinary capture (that is the only
 * way in); the day is set as its due date once Brain has made the item
 * (`PlannedRunner`). If it isn't done tomorrow it stays open, shows as
 * overdue from that day, and keeps its place in Brain's ranking.
 */
function AddForTomorrow({ plan, tomorrow }: { plan: Plan; tomorrow: DayKey }) {
  const today = plan.day;
  const { outbox } = useServices();
  const toast = useToast();
  const items = useItems();
  const { tz } = useToday();
  const waiting = plannedStore.use().filter((e) => e.day === tomorrow);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // Only what the plan holds (ideas and notes never are), filtered by date,
  // in the server's own item order: nothing is ranked or typed here.
  const inPlan = new Set([...plan.ranked, ...plan.blocked].map((r) => r.item.id));
  const open = (items.data ?? []).filter((i) => i.status === 'open' && i.dueAt.value && inPlan.has(i.id));
  const dueTomorrow = open.filter((i) => dayKey(new Date(i.dueAt.value!), tz) === tomorrow);
  const carrying = open.filter((i) => dayKey(new Date(i.dueAt.value!), tz) <= today);

  async function add(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      const entry = await outbox.enqueue(t, 'text');
      planned.add({ captureId: entry.id, day: tomorrow, text: t, addedOn: today });
      setText('');
      toast('Added for tomorrow.');
    } finally { setSaving(false); }
  }

  return (
    <section>
      <h3 className={styles.dlgH}>Add for tomorrow</h3>
      <form className={styles.addRow} onSubmit={add}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_CAPTURE_CHARS}
          placeholder="Update LinkedIn profile" aria-label="Add something for tomorrow" />
        <button className="btn primary" disabled={!text.trim() || saving}><Icon name="plus" size={14} />Add</button>
      </form>
      <p className="sub">Due tomorrow. If it isn’t done, it carries over as overdue from tomorrow and stays in Brain’s list.</p>
      {waiting.length || dueTomorrow.length ? (
        <div className={styles.tomorrowItems}>
          {waiting.map((w) => (
            <div key={w.captureId} className={styles.waitingRow}>
              <span className="spin"><Icon name="refresh" size={12} /></span><span>{w.text}</span><span className="sub">Brain is organising this…</span>
            </div>
          ))}
          {dueTomorrow.map((i) => <ItemRow key={i.id} item={i} />)}
        </div>
      ) : null}
      {carrying.length ? (
        <>
          <p className={styles.carryHead}>Carrying over · {carrying.length} still open from earlier</p>
          <div className={styles.tomorrowItems}>{carrying.map((i) => <ItemRow key={i.id} item={i} />)}</div>
        </>
      ) : null}
    </section>
  );
}
