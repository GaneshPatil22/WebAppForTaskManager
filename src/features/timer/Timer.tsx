import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Icon } from '../../ui/Icon';
import { InProgress } from '../../ui/components';
import { useToast } from '../../ui/toast';
import {
  timer, timerStore, focusLogStore, secondsLeft, useTimerTick, completeIfDue, beep, type TimerMode,
} from '../../local/timer';
import { useToday, useUpdateItem } from '../../api/queries';
import styles from './timer.module.css';

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

/** Ends timers on time, even when the timer card isn't on screen. */
export function TimerRunner() {
  const now = useTimerTick();
  const s = timerStore.use();
  const { today } = useToday();
  const toast = useToast();
  const update = useUpdateItem();

  useEffect(() => {
    const done = completeIfDue(today, now);
    if (!done) return;
    beep();
    if (done.mode === 'focus') toast('Focus session done. Take 5 minutes.');
    else if (done.mode === 'break') toast('Break over. Ready when you are.');
    else if (done.itemId) toast(`${done.label}: time is up.`, { label: 'Mark done', run: () => update.mutate({ id: done.itemId!, update: { status: 'done' } }) });
    else toast(`${done.label}: time is up.`);
  }, [now, today, toast, update]);

  useEffect(() => {
    const left = secondsLeft(s, now);
    document.title = s.endsAt !== null ? `${clock(left)} ${s.label} · Brain` : 'Brain';
  }, [s, now]);
  return null;
}

export function TimerPill() {
  const s = timerStore.use();
  const now = useTimerTick();
  const navigate = useNavigate();
  const left = secondsLeft(s, now);
  const active = s.endsAt !== null || left < s.totalSec;
  return (
    <button type="button" className={`${styles.pill} ${s.endsAt !== null ? styles.live : ''}`}
      onClick={() => { void navigate({ to: '/' }).then(() => document.getElementById('timer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }}
      aria-label={active ? `Timer ${clock(left)}, ${s.label}` : 'Open timer'}>
      <Icon name="timer" size={15} /><span>{active ? clock(left) : 'Timer'}</span>
    </button>
  );
}

const PRESETS = [5, 10, 15, 30, 45];

export function TimerCard() {
  const s = timerStore.use();
  const now = useTimerTick();
  const log = focusLogStore.use();
  const { today } = useToday();
  const [qLabel, setQLabel] = useState('');
  const [qMin, setQMin] = useState(10);
  const left = secondsLeft(s, now);
  const running = s.endsAt !== null;
  const c = 2 * Math.PI * 52;
  const sessions = log.sessions[today] ?? 0;
  const dots = sessions % 4 === 0 && sessions > 0 ? 4 : sessions % 4;

  const pick = (m: TimerMode) => (m === 'quick' ? timer.setMode('quick', { label: qLabel, minutes: qMin }) : timer.setMode(m));

  return (
    <section className="card" id="timer" aria-label="Timer">
      <h3>Timer <InProgress /></h3>
      <div className={styles.seg} role="tablist" aria-label="Timer mode">
        {([['focus', 'Focus 25'], ['break', 'Break 5'], ['quick', 'Quick timer']] as const).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={s.mode === m} className={s.mode === m ? styles.on : ''} onClick={() => pick(m)}>{label}</button>
        ))}
      </div>
      <div className={styles.ring}>
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle className={styles.track} cx="60" cy="60" r="52" fill="none" strokeWidth="8" />
          <circle className={styles.prog} cx="60" cy="60" r="52" fill="none" strokeWidth="8" strokeDasharray={c} strokeDashoffset={c * (1 - (s.totalSec ? left / s.totalSec : 0))} />
        </svg>
        <div className={styles.clock}><b>{clock(left)}</b><small title={s.label}>{s.label}</small></div>
      </div>
      <div className={styles.ctl}>
        <button type="button" className="btn primary" onClick={() => (running ? timer.pause() : timer.start())}>
          <Icon name={running ? 'pause' : 'play'} size={13} />{running ? 'Pause' : left < s.totalSec ? 'Resume' : 'Start'}
        </button>
        <button type="button" className="btn" onClick={() => timer.reset()}>Reset</button>
      </div>
      <div className={styles.dots}>
        {Array.from({ length: 4 }, (_, i) => <i key={i} className={i < dots ? styles.dotOn : ''} />)}
        <span>{sessions} focus session{sessions === 1 ? '' : 's'} today</span>
      </div>
      {s.mode === 'quick' ? (
        <div className={styles.quick}>
          <div className={styles.two}>
            <input className="input" value={qLabel} placeholder="Turn off the gas" aria-label="Timer label"
              onChange={(e) => { setQLabel(e.target.value); if (!running) timer.setMode('quick', { label: e.target.value, minutes: qMin }); }} />
            <input className="input" type="number" min={1} max={240} value={qMin} aria-label="Minutes"
              onChange={(e) => { const m = Number(e.target.value) || 1; setQMin(m); if (!running) timer.setMode('quick', { label: qLabel, minutes: m }); }} />
          </div>
          <div className={styles.chips}>
            {PRESETS.map((m) => (
              <button key={m} type="button" onClick={() => { setQMin(m); timer.setMode('quick', { label: qLabel, minutes: m }); }}>{m} min</button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
