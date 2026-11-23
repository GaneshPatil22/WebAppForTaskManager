import { useItems, useToday } from '../../api/queries';
import { addDaysToKey, D3, dayKey, fmtMinutes, shortDay, weekdayOfKey } from '../../domain/time';
import { focusLogStore } from '../../local/timer';
import { repeatsStore, isDueOn, streak } from '../../local/repeats';
import { InProgress } from '../../ui/components';
import styles from './progress.module.css';

const GOAL_MIN = 120;

export function ProgressPage() {
  const log = focusLogStore.use();
  const reps = repeatsStore.use();
  const items = useItems();
  const { today, tz } = useToday();
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(today, i - 6));
  const vals = days.map((d) => log.minutes[d] ?? 0);
  const max = Math.max(150, ...vals);
  // The server has no "done at" yet; updatedAt on a done item is the closest signal.
  const doneToday = (items.data ?? []).filter((i) => i.status === 'done' && dayKey(new Date(i.updatedAt), tz) === today).length;
  const doneWeek = (items.data ?? []).filter((i) => i.status === 'done' && days.includes(dayKey(new Date(i.updatedAt), tz))).length;
  const habits = reps.filter((r) => r.kind === 'daily');
  const cells = Array.from({ length: 21 }, (_, i) => addDaysToKey(today, i - 20));

  return (
    <>
      <div className="vhead">
        <div className="grow">
          <h1>Progress <InProgress note="Focus time and habits are recorded on this device. Items done come from Brain." /></h1>
          <p>Focus time, habits, and what got done. Focus and habits are tracked on this device for now.</p>
        </div>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}><b>{log.minutes[today] ?? 0}</b><span>Focus minutes today</span></div>
        <div className={styles.stat}><b>{log.sessions[today] ?? 0}</b><span>Focus sessions today</span></div>
        <div className={styles.stat}><b>{doneToday}</b><span>Items done today</span></div>
        <div className={styles.stat}><b>{doneWeek}</b><span>Items done in 7 days</span></div>
      </div>
      <div className={styles.grid}>
        <section className="card">
          <h3>Focus minutes</h3>
          <p className="sub">Last 7 days · {fmtMinutes(vals.reduce((a, b) => a + b, 0))} in total · dashed line is a 2 h goal</p>
          <div className={styles.chart} role="img" aria-label={`Focus minutes for the last 7 days: ${days.map((d, i) => `${shortDay(d)} ${vals[i]}`).join(', ')}`}>
            <div className={styles.gl} style={{ bottom: `calc(22px + (100% - 22px) * ${GOAL_MIN / max})` }}><span>2 h</span></div>
            {days.map((d, i) => (
              <div key={d} className={styles.bcol}>
                <div className={styles.bwrap}>
                  <div className={`${styles.bar} ${d === today ? styles.t : ''}`} style={{ height: `${Math.max((vals[i]! / max) * 100, 1.5)}%` }}>
                    <span>{vals[i]}</span>
                  </div>
                </div>
                <small>{d === today ? 'Today' : D3[weekdayOfKey(d)]}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Habit consistency</h3>
          <p className="sub">Daily repeats, last 21 days, oldest on the left</p>
          <div className={styles.heat}>
            {habits.length ? habits.map((r) => (
              <div key={r.id}>
                <div className={styles.hl}><b>{r.title}</b><span>{streak(r, today)} days in a row</span></div>
                <div className={styles.hcells}>
                  {cells.map((d) => <i key={d} className={r.doneOn.includes(d) ? styles.on : isDueOn({ ...r, paused: false }, d) ? '' : styles.off} title={`${shortDay(d)}${r.doneOn.includes(d) ? ' · done' : ''}`} />)}
                </div>
              </div>
            )) : <p className="sub">No daily repeats yet. Add one under Repeats.</p>}
            <div>
              <div className={styles.hl}><b>Focus sessions</b><span>days with at least one</span></div>
              <div className={styles.hcells}>{cells.map((d) => <i key={d} className={(log.sessions[d] ?? 0) > 0 ? `${styles.on} ${styles.f}` : ''} title={`${shortDay(d)} · ${log.sessions[d] ?? 0} sessions`} />)}</div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
