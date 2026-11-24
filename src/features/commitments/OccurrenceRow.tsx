import { useState } from 'react';
import type { Commitment, Day, OccurrenceState } from '../../api/types';
import { useSetOccurrence } from '../../api/queries';
import { Icon, type IconKey } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { addDaysToKey, fmtMinutes, shortDay, type DayKey } from '../../domain/time';
import styles from './commitments.module.css';

export const KIND_ICON: Record<Commitment['kind'], IconKey> = { habit: 'habit', ritual: 'ritual', payment: 'payment', block: 'block' };

export interface OccurrenceView {
  commitment: Commitment;
  /** The day it falls on by its rule: what the API's path takes. */
  day: Day;
  /** The day it shows on: `movedTo` if it was moved, else `day`. */
  place: Day;
  state?: OccurrenceState | undefined;
  movedTo?: Day | undefined;
}

/**
 * One scheduled commitment on one day. A checkbox, not a rank: these were
 * decided once, by you. There is no "missed" here; a day left alone simply
 * becomes a miss once it passes, and the review is where that shows.
 */
export function OccurrenceRow({ o, today, compact = false }: { o: OccurrenceView; today: DayKey; compact?: boolean }) {
  const set = useSetOccurrence();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const c = o.commitment;
  const movedIn = o.place !== o.day;
  const movedAway = o.state === 'moved' && !movedIn;
  const done = o.state === 'done';
  const skipped = o.state === 'skipped';
  const future = o.place > today;
  const quiet = movedAway || skipped;

  const run = (state: OccurrenceState | null, movedTo?: Day, msg?: string) =>
    set.mutate({ id: c.id, day: o.day, state, ...(movedTo ? { movedTo } : {}) }, {
      onSuccess: () => { if (msg) toast(msg); },
      onError: (e) => toast(errorText(e, 'Couldn’t save that.')),
    });

  // Undoing "done" on something moved here keeps it here.
  const toggle = () => (done ? (movedIn ? run('moved', o.place) : run(null)) : run('done'));

  return (
    <li className={`${styles.occ} ${done ? styles.done : ''} ${quiet ? styles.quiet : ''} ${compact ? styles.compact : ''}`}>
      <button type="button" className={styles.box} onClick={toggle} disabled={future || quiet || set.isPending}
        aria-pressed={done} aria-label={`${done ? 'Undo' : 'Mark done'}: ${c.title}`} title={future ? 'Not today yet' : undefined}>
        {done ? <Icon name="check" size={13} /> : null}
      </button>
      <div className={styles.occMain}>
        <span className={styles.occTitle}>
          {c.title}
          {c.note ? <span className={styles.note}>{c.note}</span> : null}
        </span>
        {!compact ? (
          <span className={styles.occMeta}>
            <Icon name={KIND_ICON[c.kind]} size={12} />
            {c.minutes ? <span>{fmtMinutes(c.minutes)}</span> : null}
            {c.kind === 'habit' && c.streak > 1 ? <span>{c.streak}-day streak</span> : null}
            {movedIn ? <span>moved from {shortDay(o.day)}</span> : null}
            {movedAway ? <span>moved to {shortDay(o.movedTo!)}</span> : null}
            {skipped ? <span>skipped</span> : null}
          </span>
        ) : null}
      </div>
      {quiet ? (
        <button type="button" className="btn sm quiet" onClick={() => run(null, undefined, 'Back on.')}>Undo</button>
      ) : !done && !compact ? (
        <span className={styles.occActions}>
          <button type="button" className="icon-btn" onClick={() => setMoving(true)} aria-label={`Move or skip: ${c.title}`} title="Move or skip"><Icon name="more" size={16} /></button>
        </span>
      ) : null}
      <Dialog open={moving} onClose={() => setMoving(false)} title={c.title}>
        <MoveOptions o={o} today={today} onPick={(state, to) => {
          setMoving(false);
          run(state, to, state === 'skipped' ? 'Skipped for this day. No debt carries over.' : `Moved to ${shortDay(to!)}.`);
        }} />
      </Dialog>
    </li>
  );
}

function MoveOptions({ o, today, onPick }: { o: OccurrenceView; today: DayKey; onPick: (s: OccurrenceState, to?: Day) => void }) {
  const base = o.place > today ? o.place : today;
  const [to, setTo] = useState(addDaysToKey(base, 1));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="sub">Skipping or moving one day changes nothing else. A missed day only resets a streak; the weekly review is where patterns show.</p>
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={() => onPick('moved', addDaysToKey(base, 1))}>Move to tomorrow</button>
        <button type="button" className="btn" onClick={() => onPick('skipped')}>Skip this day</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1 }}><span>Or move to</span>
          <input className="input" type="date" value={to} min={addDaysToKey(today, 0)} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={!to || to === o.day} onClick={() => onPick('moved', to)}>Move</button>
      </div>
    </div>
  );
}
