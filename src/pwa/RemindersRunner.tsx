import { useEffect } from 'react';
import { useCommitments, useOccurrences, useToday } from '../api/queries';
import { addDaysToKey } from '../domain/time';
import { buildReminders, dueReminders, HORIZON_DAYS, reminderDb, reminderPrefsStore, type Digest } from './reminders';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Keeps the reminder digest current from the server's occurrences, and
 * fires due reminders while the app is open. The service worker fires the
 * same digest in the background where the browser allows it.
 */
export function RemindersRunner() {
  const prefs = reminderPrefsStore.use();
  const { today, tz } = useToday();
  const on = prefs.enabled && notificationsSupported() && Notification.permission === 'granted';
  const occ = useOccurrences(on ? { from: today, through: addDaysToKey(today, HORIZON_DAYS) } : null);
  const commitments = useCommitments();

  useEffect(() => {
    if (!on) { void reminderDb.saveDigest(null).catch(() => {}); return; }
    if (!occ.data || !commitments.data) return;
    const digest: Digest = { tz, builtAt: new Date().toISOString(), reminders: buildReminders(today, occ.data, commitments.data, prefs) };
    void reminderDb.saveDigest(digest).then(() => fireDue()).catch(() => {});
  }, [on, occ.data, commitments.data, today, tz, prefs]);

  useEffect(() => {
    if (!on) return;
    const tick = () => void fireDue().catch(() => {});
    const iv = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    void registerPeriodicSync();
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); };
  }, [on]);

  return null;
}

/** Shows every due reminder once. Through the service worker when there is one. */
export async function fireDue(now = new Date()) {
  const digest = await reminderDb.digest();
  if (!digest) return;
  const due = dueReminders(digest, now, await reminderDb.shown());
  if (!due.length) return;
  await reminderDb.markShown(due.map((r) => r.id));
  for (const r of due) await show(r.title, r.body, r.id, r.url);
}

export async function show(title: string, body: string, tag: string, url = '/') {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) await reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url } });
  else new Notification(title, { body, tag, icon: '/icon-192.png' });
}

/** Chrome, installed app only: lets the worker check for due reminders now and then. */
async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const ps = (reg as unknown as { periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> } } | undefined)?.periodicSync;
    if (!ps) return;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (status.state === 'granted') await ps.register('brain-reminders', { minInterval: 60 * 60 * 1000 });
  } catch { /* not supported: reminders fire while the app is open */ }
}
