import { useEffect, useSyncExternalStore } from 'react';
import { createLocalStore } from './store';
import type { DayKey } from '../domain/time';

/**
 * IN PROGRESS: timers (Brain backlog B-02) run on this device only. The end
 * time is stored, not a countdown, so a reload or a sleeping laptop does
 * not lose time. Focus minutes are logged per day for the Progress view;
 * later they are the measured-effort signal B-02 talks about.
 */
export type TimerMode = 'focus' | 'break' | 'quick';

export interface TimerState {
  mode: TimerMode;
  label: string;
  itemId: string | null;
  totalSec: number;
  /** Seconds left while paused; ignored while running. */
  leftSec: number;
  /** Epoch ms when it ends, while running. */
  endsAt: number | null;
}

export interface FocusLog {
  minutes: Record<DayKey, number>;
  sessions: Record<DayKey, number>;
}

export const FOCUS_SEC = 25 * 60;
export const BREAK_SEC = 5 * 60;

const fresh = (mode: TimerMode = 'focus', totalSec = FOCUS_SEC, label = 'Focus'): TimerState =>
  ({ mode, label, itemId: null, totalSec, leftSec: totalSec, endsAt: null });

export const timerStore = createLocalStore<TimerState>('brain-local-timer-v1', () => fresh());
export const focusLogStore = createLocalStore<FocusLog>('brain-local-focus-v1', () => ({ minutes: {}, sessions: {} }));

export function secondsLeft(s: TimerState, now = Date.now()): number {
  return s.endsAt === null ? s.leftSec : Math.max(0, Math.ceil((s.endsAt - now) / 1000));
}

export const timer = {
  setMode(mode: TimerMode, quick?: { label: string; minutes: number; itemId?: string | null }) {
    if (mode === 'focus') timerStore.set(fresh('focus', FOCUS_SEC, 'Focus'));
    else if (mode === 'break') timerStore.set(fresh('break', BREAK_SEC, 'Break'));
    else {
      const minutes = Math.min(240, Math.max(1, Math.round(quick?.minutes ?? 10)));
      timerStore.set({ ...fresh('quick', minutes * 60, quick?.label || 'Quick timer'), itemId: quick?.itemId ?? null });
    }
  },
  start(now = Date.now()) {
    timerStore.set((s) => {
      const left = s.leftSec > 0 ? s.leftSec : s.totalSec;
      return { ...s, leftSec: left, endsAt: now + left * 1000 };
    });
  },
  pause(now = Date.now()) {
    timerStore.set((s) => ({ ...s, leftSec: secondsLeft(s, now), endsAt: null }));
  },
  reset() {
    timerStore.set((s) => ({ ...s, leftSec: s.totalSec, endsAt: null }));
  },
  /** Focus on an item: 25-min focus for longer work, a quick timer otherwise. */
  forItem(item: { id: string; title: string }, minutes: number, now = Date.now()) {
    if (minutes >= 25) timerStore.set({ ...fresh('focus', FOCUS_SEC, `Focus: ${item.title}`), itemId: item.id });
    else timer.setMode('quick', { label: item.title, minutes, itemId: item.id });
    timer.start(now);
  },
};

export type FinishedEvent = { mode: TimerMode; label: string; itemId: string | null; minutes: number };

/** Moves a finished timer on: focus → break → focus. Returns what finished. */
export function completeIfDue(today: DayKey, now = Date.now()): FinishedEvent | null {
  const s = timerStore.get();
  if (s.endsAt === null || secondsLeft(s, now) > 0) return null;
  const done: FinishedEvent = { mode: s.mode, label: s.label, itemId: s.itemId, minutes: Math.round(s.totalSec / 60) };
  if (s.mode === 'focus') {
    focusLogStore.set((l) => ({
      minutes: { ...l.minutes, [today]: (l.minutes[today] ?? 0) + done.minutes },
      sessions: { ...l.sessions, [today]: (l.sessions[today] ?? 0) + 1 },
    }));
    timerStore.set(fresh('break', BREAK_SEC, 'Break'));
  } else if (s.mode === 'break') {
    timerStore.set(fresh());
  } else {
    timerStore.set({ ...s, leftSec: s.totalSec, endsAt: null });
  }
  return done;
}

/** Re-renders every 250 ms while a timer runs, and not at all otherwise. */
export function useTimerTick(): number {
  const s = timerStore.use();
  const now = useSyncExternalStore(tick.subscribe, tick.get, tick.get);
  useEffect(() => {
    if (s.endsAt === null) return;
    tick.start();
    return () => tick.stop();
  }, [s.endsAt]);
  return now;
}

const tick = (() => {
  let now = Date.now();
  let iv: ReturnType<typeof setInterval> | null = null;
  let users = 0;
  const ls = new Set<() => void>();
  return {
    get: () => now,
    subscribe(l: () => void) { ls.add(l); return () => ls.delete(l); },
    start() {
      users++;
      if (iv) return;
      iv = setInterval(() => { now = Date.now(); for (const l of ls) l(); }, 250);
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
