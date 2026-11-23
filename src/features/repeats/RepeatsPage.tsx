import { useState, type FormEvent } from 'react';
import { useToday } from '../../api/queries';
import { repeats, repeatsStore, nextDueOn, ruleText, type RepeatKind } from '../../local/repeats';
import { DAYS, MONTHS, fmtMinutes, shortDay, weekdayOfKey, dayOfMonthOfKey } from '../../domain/time';
import { Dialog } from '../../ui/Dialog';
import { InProgress } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import { RepeatLead, StreakText } from './RepeatsWidgets';
import styles from './repeats.module.css';

const SECTIONS: { kind: RepeatKind; title: string; sub: string }[] = [
  { kind: 'daily', title: 'Every day', sub: 'Habits and daily fixes' },
  { kind: 'weekly', title: 'Every week', sub: 'Planning and review rituals' },
  { kind: 'monthly', title: 'Every month', sub: 'Money dates and bills' },
];

export function RepeatsPage() {
  const list = repeatsStore.use();
  const { today } = useToday();
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const [y, m] = today.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const dim = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const offset = (weekdayOfKey(first) + 6) % 7;
  const monthly = list.filter((r) => r.kind === 'monthly' && !r.paused);

  return (
    <>
      <div className="vhead">
        <div className="grow">
          <h1>Repeats <InProgress /></h1>
          <p>Things that come back on their own. Kept on this device until Brain models recurring items (backlog B-05).</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} />New repeat</button>
      </div>
      <div className={styles.layout}>
        <div>
          {SECTIONS.map((s) => {
            const rows = list.filter((r) => r.kind === s.kind);
            return (
              <div key={s.kind} className={styles.rsec}>
                <h2>{s.title}</h2><p className="sub">{s.sub}</p>
                <ul className="list">
                  {rows.length ? rows.map((r) => {
                    const d = nextDueOn(r, today);
                    const doneToday = r.doneOn.includes(today);
                    return (
                      <li key={r.id} className={`${styles.row} ${r.paused ? styles.isDone : ''}`}>
                        <RepeatLead r={r} done={doneToday} onDay={d ?? today} onToggle={d === today ? () => repeats.toggleDone(r.id, today) : undefined} />
                        <div>
                          <div className={styles.rtitle}>{r.title}</div>
                          <div className="meta"><span>{ruleText(r)}</span><span>{fmtMinutes(r.minutes)}</span><StreakText r={r} today={today} /></div>
                        </div>
                        <div className={styles.racts}>
                          <span className={styles.rnext}>{r.paused ? 'Paused' : d === today ? 'Due today' : d ? `Next: ${shortDay(d)}` : ''}</span>
                          <button className={styles.switch} aria-pressed={!r.paused} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${r.title}`} onClick={() => repeats.togglePause(r.id)} />
                          <button className="icon-btn" aria-label={`Delete ${r.title}`} onClick={() => {
                            const snapshot = repeatsStore.get();
                            repeats.remove(r.id);
                            toast('Repeat deleted.', { label: 'Undo', run: () => repeatsStore.set(snapshot) });
                          }}><Icon name="close" size={14} /></button>
                        </div>
                      </li>
                    );
                  }) : <li className="empty">None yet.</li>}
                </ul>
              </div>
            );
          })}
        </div>
        <aside className="card">
          <h3>{MONTHS[m! - 1]} money dates</h3>
          <p className="sub">Monthly repeats on the calendar</p>
          <div className={styles.cal}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <div key={i} className={styles.h}>{x}</div>)}
            {Array.from({ length: offset }, (_, i) => <div key={`b${i}`} className={`${styles.c} ${styles.blank}`} />)}
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1;
              const key = `${first.slice(0, 8)}${String(d).padStart(2, '0')}`;
              const hits = monthly.filter((r) => nextDueOn(r, key, 1) === key);
              return (
                <div key={d} className={`${styles.c} ${hits.length ? styles.mark : ''} ${dayOfMonthOfKey(today) === d ? styles.now : ''}`}>
                  <span>{d}</span>{hits.map((h) => <em key={h.id}>{h.title}</em>)}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
      <NewRepeat open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function NewRepeat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { today } = useToday();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RepeatKind>('daily');
  const [weekday, setWeekday] = useState(0);
  const [monthDay, setMonthDay] = useState(1);
  const [minutes, setMinutes] = useState(15);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    repeats.add({ title: title.trim(), kind, minutes, ...(kind === 'weekly' ? { weekday } : {}), ...(kind === 'monthly' ? { monthDay } : {}) }, today);
    toast('Repeat added.');
    setTitle('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={<>New repeat <InProgress /></>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field"><span>What</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SIP ₹5,000" required maxLength={200} /></label>
        <label className="field"><span>How often</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as RepeatKind)}>
            <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
          </select>
        </label>
        {kind === 'weekly' ? (
          <label className="field"><span>On</span>
            <select className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
            </select>
          </label>
        ) : null}
        {kind === 'monthly' ? (
          <label className="field"><span>Day of the month (31 means the last day in shorter months)</span>
            <input className="input" type="number" min={1} max={31} value={monthDay} onChange={(e) => setMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
        ) : null}
        <label className="field"><span>Minutes</span><input className="input" type="number" min={1} max={480} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Add repeat</button>
        </div>
      </form>
    </Dialog>
  );
}
