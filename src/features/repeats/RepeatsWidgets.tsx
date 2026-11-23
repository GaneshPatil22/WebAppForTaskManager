import { Link } from '@tanstack/react-router';
import { useToday } from '../../api/queries';
import { repeats, repeatsStore, isDueOn, nextDueOn, streak, ruleText, type Repeat } from '../../local/repeats';
import { addDaysToKey, D3, fmtMinutes, M3, relativeDay, shortDay } from '../../domain/time';
import { InProgress } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import styles from './repeats.module.css';

export function RepeatLead({ r, done, onDay, onToggle }: { r: Repeat; done: boolean; onDay?: string; onToggle?: () => void }) {
  const inner = done ? <Icon name="check" size={15} />
    : r.kind === 'daily' ? <Icon name="repeat" size={14} />
    : r.kind === 'weekly' ? <span>{D3[r.weekday ?? 0]}</span>
    : <><b>{r.monthDay}</b><i>{onDay ? M3[Number(onDay.slice(5, 7)) - 1] : ''}</i></>;
  const cls = `${styles.lead} ${styles[r.kind]} ${done ? styles.done : ''}`;
  return onToggle
    ? <button type="button" className={cls} onClick={onToggle} aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${r.title}`}>{inner}</button>
    : <span className={cls} aria-hidden>{inner}</span>;
}

export function KindChip({ r }: { r: Repeat }) {
  return <span className={`chip ${r.kind}`}><Icon name="repeat" size={11} />{ruleText(r)}</span>;
}

export function StreakText({ r, today }: { r: Repeat; today: string }) {
  const n = streak(r, today);
  if (!n) return null;
  const unit = r.kind === 'daily' ? 'day' : r.kind === 'weekly' ? 'week' : 'month';
  return <span className={styles.streak}>{n} {unit}{n === 1 ? '' : 's'} in a row</span>;
}

/** Repeats due today, on the Today page. */
export function TodayRepeats() {
  const list = repeatsStore.use();
  const { today } = useToday();
  const due = list.filter((r) => isDueOn(r, today));
  if (!due.length) return null;
  return (
    <>
      <h2 className="section-title">Today’s repeats <InProgress /></h2>
      <ul className="list">
        {due.map((r) => {
          const done = r.doneOn.includes(today);
          return (
            <li key={r.id} className={`${styles.row} ${done ? styles.isDone : ''}`}>
              <RepeatLead r={r} done={done} onDay={today} onToggle={() => repeats.toggleDone(r.id, today)} />
              <div><div className={styles.rtitle}>{r.title}</div><div className="meta"><KindChip r={r} /><span>{fmtMinutes(r.minutes)}</span><StreakText r={r} today={today} /></div></div>
              <span />
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function ComingUpCard() {
  const list = repeatsStore.use();
  const { today } = useToday();
  const up = list.filter((r) => r.kind !== 'daily' && !r.paused)
    .map((r) => ({ r, d: nextDueOn(r, addDaysToKey(today, 1)) }))
    .filter((x): x is { r: Repeat; d: string } => !!x.d)
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(0, 5);
  if (!up.length) return null;
  return (
    <section className="card">
      <h3>Coming up <InProgress /></h3>
      <p className="sub">Weekly and monthly repeats. <Link to="/repeats">Manage</Link></p>
      <ul className={styles.ulist}>
        {up.map(({ r, d }) => (
          <li key={r.id}>
            <RepeatLead r={r} done={false} onDay={d} />
            <div><div style={{ fontWeight: 600, lineHeight: 1.3 }}>{r.title}</div><div className="meta" style={{ marginTop: 2 }}><KindChip r={r} /></div></div>
            <div className={styles.when}><b>{relativeDay(d, today)}</b><br />{shortDay(d)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

