import { useEffect, useSyncExternalStore } from 'react';
import { createLocalStore } from './store';
import type { DayKey } from '../domain/time';

/**
 * Timers (Brain backlog B-02) run on this device only.
 *
 * Three independent countdowns — focus, break and quick — that run in
 * parallel. The tabs on the timer card only choose which one you are
 * looking at; switching never stops or resets anything. So a 25-minute
 * focus can run while a 10-minute "gas off" quick timer counts down.
 *
 * Each running countdown stores its end time, not a ticking number, so a
 * reload or a sleeping laptop does not lose time. Focus minutes are logged
 * per day for the Progress view.
 */
export type TimerMode = 'focus' | 'break' | 'quick';
export const MODES: readonly TimerMode[] = ['focus', 'break', 'quick'];

export interface Countdown {
  label: string;
  itemId: string | null;
  totalSec: number;
  /** Seconds left while paused or stopped; ignored while running. */
  leftSec: number;
  /** Epoch ms when it ends, while running; null otherwise. */
  endsAt: number | null;
}

export interface TimerState {
  /** Which countdown the card shows. Purely a view choice. */
  view: TimerMode;
  focus: Countdown;
  break: Countdown;
  quick: Countdown;
}

export interface FocusLog {
  minutes: Record<DayKey, number>;
  sessions: Record<DayKey, number>;
}

export const FOCUS_SEC = 25 * 60;
export const BREAK_SEC = 5 * 60;
const QUICK_DEFAULT_SEC = 10 * 60;

const countdown = (totalSec: number, label: string, itemId: string | null = null): Countdown =>
  ({ label, itemId, totalSec, leftSec: totalSec, endsAt: null });

const freshFocus = () => countdown(FOCUS_SEC, 'Focus');
const freshBreak = () => countdown(BREAK_SEC, 'Break');
const freshQuick = () => countdown(QUICK_DEFAULT_SEC, 'Quick timer');

const initial = (): TimerState => ({ view: 'focus', focus: freshFocus(), break: freshBreak(), quick: freshQuick() });

// v2: the shape changed from one countdown to three, so old v1 state is ignored.
export const timerStore = createLocalStore<TimerState>('brain-local-timer-v2', initial);
export const focusLogStore = createLocalStore<FocusLog>('brain-local-focus-v1', () => ({ minutes: {}, sessions: {} }));

/** Seconds left, never more than the countdown's length (guards a stale `now`). */
export function secondsLeft(c: Countdown, now = Date.now()): number {
  if (c.endsAt === null) return c.leftSec;
  return Math.min(c.totalSec, Math.max(0, Math.ceil((c.endsAt - now) / 1000)));
}

export const isRunning = (c: Countdown) => c.endsAt !== null;

function update(mode: TimerMode, f: (c: Countdown) => Countdown) {
  timerStore.set((s) => ({ ...s, [mode]: f(s[mode]) }));
}

export const timer = {
  view(mode: TimerMode) {
    timerStore.set((s) => ({ ...s, view: mode }));
  },
  start(mode: TimerMode, now = Date.now()) {
    // Move the shared clock to this instant before anything renders, so the
    // first frame after Start can't be computed against an old `now`.
    tick.touch(now);
    update(mode, (c) => {
      const left = c.leftSec > 0 ? c.leftSec : c.totalSec;
      return { ...c, leftSec: left, endsAt: now + left * 1000 };
    });
  },
  pause(mode: TimerMode, now = Date.now()) {
    update(mode, (c) => ({ ...c, leftSec: secondsLeft(c, now), endsAt: null }));
  },
  reset(mode: TimerMode) {
    update(mode, (c) => ({ ...c, leftSec: c.totalSec, endsAt: null }));
  },
  /** Sets up the quick timer. Ignored while it runs, so typing can't disturb it. */
  setQuick(label: string, minutes: number, itemId: string | null = null) {
    update('quick', (c) => {
      if (isRunning(c)) return c;
      const m = Math.min(240, Math.max(1, Math.round(minutes || 1)));
      return countdown(m * 60, label.trim() || 'Quick timer', itemId);
    });
  },
  /** Focus on an item: 25-minute focus for longer work, a quick timer otherwise. */
  forItem(item: { id: string; title: string }, minutes: number, now = Date.now()) {
    if (minutes >= 25) {
      timerStore.set((s) => ({ ...s, view: 'focus', focus: countdown(FOCUS_SEC, `Focus: ${item.title}`, item.id) }));
      timer.start('focus', now);
    } else {
      const m = Math.min(240, Math.max(1, Math.round(minutes)));
      timerStore.set((s) => ({ ...s, view: 'quick', quick: countdown(m * 60, item.title, item.id) }));
      timer.start('quick', now);
    }
  },
};

export type FinishedEvent = { mode: TimerMode; label: string; itemId: string | null; minutes: number };

/**
 * Finishes every countdown whose time is up and returns what finished.
 * Focus logs a session and readies a break; break readies a new focus;
 * quick rewinds to its full length. Countdowns that are still running are
 * left alone.
 */
export function completeDue(today: DayKey, now = Date.now()): FinishedEvent[] {
  const s = timerStore.get();
  const due = MODES.filter((m) => isRunning(s[m]) && secondsLeft(s[m], now) === 0);
  if (!due.length) return [];
  const next: TimerState = { ...s };
  const done: FinishedEvent[] = [];
  for (const m of due) {
    const c = s[m];
    done.push({ mode: m, label: c.label, itemId: c.itemId, minutes: Math.round(c.totalSec / 60) });
    if (m === 'focus') {
      next.focus = freshFocus();
      if (!isRunning(s.break)) next.break = freshBreak();
      if (s.view === 'focus') next.view = 'break';
    } else if (m === 'break') {
      next.break = freshBreak();
      if (!isRunning(s.focus)) next.focus = freshFocus();
      if (s.view === 'break') next.view = 'focus';
    } else {
      next.quick = { ...c, leftSec: c.totalSec, endsAt: null };
    }
  }
  timerStore.set(next);
  const focusDone = done.find((d) => d.mode === 'focus');
  if (focusDone) {
    focusLogStore.set((l) => ({
      minutes: { ...l.minutes, [today]: (l.minutes[today] ?? 0) + focusDone.minutes },
      sessions: { ...l.sessions, [today]: (l.sessions[today] ?? 0) + 1 },
    }));
  }
  return done;
}

/** Running countdowns, soonest to end first. */
export function running(s: TimerState): { mode: TimerMode; c: Countdown }[] {
  return MODES.filter((m) => isRunning(s[m]))
    .map((m) => ({ mode: m, c: s[m] }))
    .sort((a, b) => a.c.endsAt! - b.c.endsAt!);
}

/** Re-renders every 250 ms while any countdown runs, and not at all otherwise. */
export function useTimerTick(): number {
  const s = timerStore.use();
  const now = useSyncExternalStore(tick.subscribe, tick.get, tick.get);
  const anyRunning = MODES.some((m) => isRunning(s[m]));
  useEffect(() => {
    if (!anyRunning) return;
    tick.start();
    return () => tick.stop();
  }, [anyRunning]);
  return now;
}

const tick = (() => {
  let now = Date.now();
  let iv: ReturnType<typeof setInterval> | null = null;
  let users = 0;
  const ls = new Set<() => void>();
  const emit = () => { for (const l of ls) l(); };
  return {
    get: () => now,
    subscribe(l: () => void) { ls.add(l); return () => ls.delete(l); },
    /** Jump the clock to a known instant (the moment a timer starts). */
    touch(at = Date.now()) { now = at; emit(); },
    start() {
      users++;
      now = Date.now();
      if (iv) return;
      iv = setInterval(() => { now = Date.now(); emit(); }, 250);
    },
    stop() {
      users = Math.max(0, users - 1);
      if (!users && iv) { clearInterval(iv); iv = null; }
    },
  };
})();

export function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g);
      g.connect(c.destination);
      o.start(c.currentTime + t);
      o.stop(c.currentTime + t + 0.15);
    });
  } catch { /* no audio: the toast still shows */ }
}
