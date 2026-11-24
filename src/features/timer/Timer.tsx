import { useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/toast';
import {
  timer, timerStore, focusLogStore, secondsLeft, useTimerTick, completeDue, beep, isRunning, running, MODES,
  type TimerMode,
} from '../../local/timer';
import { useToday, useUpdateItem } from '../../api/queries';
import styles from './timer.module.css';

/**
 * A focus and quick timer, on this device only. Focus, break and quick run
 * in parallel; the tabs only choose which one you look at.
 */
const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (sec: number) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const TAB: Record<TimerMode, string> = { focus: 'Focus 25', break: 'Break 5', quick: 'Quick' };

/** Ends timers on time, even when the timer isn't on screen. */
export function TimerRunner() {
  const now = useTimerTick();
  const s = timerStore.use();
  const { today } = useToday();
  const toast = useToast();
  const update = useUpdateItem();

  useEffect(() => {
    const done = completeDue(today, now);
    if (!done.length) return;
    beep();
    for (const d of done) {
      if (d.mode === 'focus') toast('Focus session done. Take 5 minutes.');
      else if (d.mode === 'break') toast('Break over. Ready when you are.');
      else if (d.itemId) toast(`${d.label}: time is up.`, { label: 'Mark done', run: () => update.mutate({ id: d.itemId!, update: { status: 'done' } }) });
      else toast(`${d.label}: time is up.`);
    }
  }, [now, today, toast, update]);

  useEffect(() => {
    const first = running(s)[0];
    document.title = first ? `${clock(secondsLeft(first.c, now))} ${first.c.label} · Brain` : 'Brain';
  }, [s, now]);
  return null;
}

export function TimerPill() {
  const s = timerStore.use();
  const now = useTimerTick();
  const [open, setOpen] = useState(false);
  const live = running(s);
  const first = live[0];
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('brain:timer', show);
    return () => window.removeEventListener('brain:timer', show);
  }, []);
  return (
    <>
      <button type="button" className={`${styles.pill} ${first ? styles.live : ''}`}
        onClick={() => { if (first) timer.view(first.mode); setOpen(true); }}
        aria-label={first ? `${live.length} timer${live.length === 1 ? '' : 's'} running. ${first.c.label}, ${clock(secondsLeft(first.c, now))} left` : 'Open timer'}>
        <Icon name="timer" size={15} />
        {first ? <span className="tnum">{clock(secondsLeft(first.c, now))}</span> : null}
        {live.length > 1 ? <span className={styles.more}>+{live.length - 1}</span> : null}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Timer"><TimerBody /></Dialog>
    </>
  );
}

/** Starts a timer for an item and shows it. */
export function focusOn(item: { id: string; title: string }, minutes: number) {
  timer.forItem(item, minutes);
  window.dispatchEvent(new Event('brain:timer'));
}

const PRESETS = [5, 10, 15, 30, 45];

function TimerBody() {
  const s = timerStore.use();
  const now = useTimerTick();
  const log = focusLogStore.use();
  const { today } = useToday();
  const mode = s.view;
  const c = s[mode];
  const left = secondsLeft(c, now);
  const on = isRunning(c);
  const ring = 2 * Math.PI * 52;
  const sessions = log.sessions[today] ?? 0;

  return (
    <div className={styles.body}>
      <div className="seg" role="tablist" aria-label="Timer" style={{ alignSelf: 'center' }}>
        {MODES.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => timer.view(m)}>
            {TAB[m]}{isRunning(s[m]) ? <span className={styles.tabClock}> {clock(secondsLeft(s[m], now))}</span> : null}
          </button>
        ))}
      </div>
      <div className={styles.ring}>
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle className={styles.track} cx="60" cy="60" r="52" fill="none" strokeWidth="6" />
          <circle className={styles.prog} cx="60" cy="60" r="52" fill="none" strokeWidth="6" strokeDasharray={ring} strokeDashoffset={ring * (1 - (c.totalSec ? left / c.totalSec : 0))} />
        </svg>
        <div className={styles.clock}><b className="tnum">{clock(left)}</b><small title={c.label}>{c.label}</small></div>
      </div>
      <div className={styles.ctl}>
        <button type="button" className="btn primary" onClick={() => (on ? timer.pause(mode) : timer.start(mode))}>
          <Icon name={on ? 'pause' : 'play'} size={13} />{on ? 'Pause' : left < c.totalSec ? 'Resume' : 'Start'}
        </button>
        <button type="button" className="btn" onClick={() => timer.reset(mode)}>Reset</button>
      </div>
      <p className="sub" style={{ textAlign: 'center' }}>{sessions} focus session{sessions === 1 ? '' : 's'} today · on this device</p>
      {mode === 'quick' ? <QuickSetup /> : null}
    </div>
  );
}

function QuickSetup() {
  const q = timerStore.use().quick;
  const locked = isRunning(q);
  const [label, setLabel] = useState(q.label === 'Quick timer' ? '' : q.label);
  const [minutes, setMinutes] = useState(Math.round(q.totalSec / 60));
  const apply = (l: string, m: number) => timer.setQuick(l, m);
  return (
    <div className={styles.quick}>
      <div className={styles.two}>
        <input className="input" value={label} placeholder="Turn off the gas" aria-label="Timer label" disabled={locked}
          onChange={(e) => { setLabel(e.target.value); apply(e.target.value, minutes); }} />
        <input className="input" type="number" min={1} max={240} value={minutes} aria-label="Minutes" disabled={locked}
          onChange={(e) => { const m = Number(e.target.value) || 1; setMinutes(m); apply(label, m); }} />
      </div>
      {locked ? <p className="sub">Running. Pause or reset it to change it.</p> : (
        <div className={styles.chips}>
          {PRESETS.map((m) => <button key={m} type="button" onClick={() => { setMinutes(m); apply(label, m); }}>{m} min</button>)}
        </div>
      )}
    </div>
  );
}
