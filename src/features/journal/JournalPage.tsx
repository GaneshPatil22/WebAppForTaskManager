import { useState } from 'react';
import type { JournalEntry } from '../../api/types';
import { useJournal, useToday } from '../../api/queries';
import { QueryProblem, Skeleton } from '../../ui/components';
import { JournalEditor } from './JournalEditor';
import { addDaysToKey, D3, longDay, shortDay, weekdayOfKey, type DayKey } from '../../domain/time';
import styles from './journal.module.css';

const WINDOW = 90;

/** One entry a day, newest first. Not an item: it never ranks or blocks. */
export function JournalPage() {
  const { today } = useToday();
  const [windows, setWindows] = useState(1);
  const [other, setOther] = useState('');

  return (
    <>
      <div className="page-head"><div className="grow"><h1>Journal</h1><p>A few lines a day. Only you read this.</p></div></div>
      <section className="card">
        <h2 className={styles.day} style={{ marginBottom: 8 }}>{longDay(today)}</h2>
        <TodayEntry today={today} />
      </section>
      <div className="section-head">
        <h2>Earlier</h2><span className="grow" />
        <label className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Write for
          <input className="input" type="date" style={{ width: 'auto', padding: '4px 8px' }} max={addDaysToKey(today, -1)} value={other} onChange={(e) => setOther(e.target.value)} />
        </label>
      </div>
      {other ? <OtherDay day={other} onDone={() => setOther('')} /> : null}
      <div className={styles.entries}>
        {Array.from({ length: windows }, (_, i) => <Window key={i} through={addDaysToKey(today, -1 - i * WINDOW)} />)}
      </div>
      <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => setWindows(windows + 1)}>Show earlier</button>
    </>
  );
}

function TodayEntry({ today }: { today: DayKey }) {
  const j = useJournal({ from: today, through: today });
  if (j.error) return <QueryProblem error={j.error} what="today’s entry" />;
  if (!j.data) return <Skeleton rows={1} />;
  return <JournalEditor day={today} entry={j.data[0]} />;
}

function OtherDay({ day, onDone }: { day: DayKey; onDone: () => void }) {
  const j = useJournal({ from: day, through: day });
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3 className={styles.day} style={{ marginBottom: 8 }}>{longDay(day)}</h3>
      {j.data ? <JournalEditor day={day} entry={j.data[0]} autoFocus onSaved={onDone} /> : <Skeleton rows={1} />}
    </div>
  );
}

function Window({ through }: { through: DayKey }) {
  const from = addDaysToKey(through, -(WINDOW - 1));
  const j = useJournal({ from, through });
  if (j.error) return <QueryProblem error={j.error} what="the journal" onRetry={() => void j.refetch()} />;
  if (!j.data) return <Skeleton rows={3} />;
  if (!j.data.length) return <p className="empty">No entries between {shortDay(from)} and {shortDay(through)}.</p>;
  return <>{[...j.data].reverse().map((e) => <Entry key={e.day} e={e} />)}</>;
}

function Entry({ e }: { e: JournalEntry }) {
  const [editing, setEditing] = useState(false);
  return (
    <article className={styles.entry}>
      <div className={styles.day}>{D3[weekdayOfKey(e.day)]} {shortDay(e.day).slice(4)}<small>{e.day.slice(0, 4)}</small></div>
      {editing ? <JournalEditor day={e.day} entry={e} autoFocus onSaved={() => setEditing(false)} />
        : <button type="button" className={styles.bodyBtn} onClick={() => setEditing(true)} title="Edit">{e.body}</button>}
    </article>
  );
}
