import { useState } from 'react';
import { useMe, useUpdateTimezone } from '../../api/queries';
import { useServices } from '../../app/services';
import { useAuth } from '../../auth/auth';
import { prefsStore, setPref } from '../../app/prefs';
import { themeStore, type ThemePref } from '../../app/theme';
import { Icon } from '../../ui/Icon';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { reminderPrefsStore, type ReminderPrefs } from '../../pwa/reminders';
import { notificationsSupported, show } from '../../pwa/RemindersRunner';
import { useInstall } from '../../pwa/install';
import { timezoneOptions } from './timezones';
import styles from './settings.module.css';

export function SettingsPage() {
  return (
    <>
      <div className="page-head"><div className="grow"><h1>Settings</h1></div></div>
      <div className={styles.stack}>
        <Account />
        <Today />
        <Reminders />
        <Install />
        <Appearance />
        <MockTools />
      </div>
    </>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sHead}><h2>{title}</h2>{sub ? <p className="sub">{sub}</p> : null}</div>
      <div className={styles.sBody}>{children}</div>
    </section>
  );
}

function Account() {
  const { auth, state } = useAuth();
  const me = useMe();
  const tz = useUpdateTimezone();
  const toast = useToast();
  const current = me.data?.timezone;
  const zones = timezoneOptions(current);
  return (
    <Section title="Account" sub="“Today” is computed in this timezone, on the server, for every device.">
      {state.status === 'signedIn' && state.email ? <p>Signed in as <b>{state.email}</b></p> : null}
      <label className="field" style={{ maxWidth: 360 }}><span>Timezone</span>
        <select className="input" value={current ?? ''} disabled={!current || tz.isPending}
          onChange={(e) => tz.mutate(e.target.value, { onSuccess: () => toast('Timezone saved.'), onError: (x) => toast(errorText(x)) })}>
          {!current ? <option value="">Loading…</option> : null}
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      {auth.mode === 'supabase' ? <div><button type="button" className="btn" onClick={() => void auth.signOut()}>Sign out</button></div> : null}
    </Section>
  );
}

function Today() {
  const p = prefsStore.use();
  return (
    <Section title="Today" sub="How Today shows Brain’s ranking. These only change the display, on this device.">
      <label className="check"><input type="checkbox" checked={p.board} onChange={(e) => setPref('board', e.target.checked)} />
        <span>Show candidates as a 1-3-5 board <span className="muted">(one big, three medium, five quick; rearrangeable)</span></span></label>
      <label className="check"><input type="checkbox" checked={p.timer} onChange={(e) => setPref('timer', e.target.checked)} />
        <span>Focus timer in the top bar <span className="muted">(on this device only)</span></span></label>
    </Section>
  );
}

function Reminders() {
  const prefs = reminderPrefsStore.use();
  const toast = useToast();
  const supported = notificationsSupported();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');
  const set = (u: Partial<ReminderPrefs>) => reminderPrefsStore.set((x) => ({ ...x, ...u }));

  const enable = async (on: boolean) => {
    if (!on) { set({ enabled: false }); return; }
    if (!supported) return;
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPerm(p);
    if (p === 'granted') { set({ enabled: true }); toast('Reminders on.'); } else toast('Notifications are blocked for this site. Allow them in the browser’s site settings.');
  };

  return (
    <Section title="Reminders" sub="A morning note of the day’s commitments, and a heads-up the evening before each payment.">
      {!supported ? <p className="banner">This browser can’t show notifications. On iPhone, add Brain to the Home Screen first (Share → Add to Home Screen).</p> : (
        <>
          <label className="check"><input type="checkbox" checked={prefs.enabled && perm === 'granted'} onChange={(e) => void enable(e.target.checked)} /><span>Remind me</span></label>
          {perm === 'denied' ? <p className="banner danger">Notifications are blocked for this site. Allow them in the browser’s site settings, then switch this on.</p> : null}
          <div className="form-grid" style={{ maxWidth: 480 }}>
            <label className="field"><span>Morning note at</span><input className="input" type="time" value={prefs.morningAt} onChange={(e) => set({ morningAt: e.target.value || '08:00' })} /></label>
            <label className="field"><span>Payment heads-up at</span><input className="input" type="time" value={prefs.eveningAt} disabled={!prefs.paymentEve} onChange={(e) => set({ eveningAt: e.target.value || '20:00' })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={prefs.paymentEve} onChange={(e) => set({ paymentEve: e.target.checked })} /><span>Heads-up the evening before a payment</span></label>
          <p className="sub">
            Reminders come from this device; Brain has no push server yet. They show when the app is open, and on Chrome with Brain
            installed, in the background too (the browser decides how often, roughly hourly at best). Times are in your Brain timezone.
          </p>
          {prefs.enabled && perm === 'granted' ? <div><button type="button" className="btn sm" onClick={() => void show('Brain reminders work', 'You’ll get the day’s commitments here.', 'test')}><Icon name="bell" size={13} />Send a test</button></div> : null}
        </>
      )}
    </Section>
  );
}

function Install() {
  const { canPrompt, installed, prompt } = useInstall();
  return (
    <Section title="Install" sub="Brain on your home screen opens offline, so you can always capture, and can remind you.">
      {installed ? <p>Installed. You’re using the app.</p> : canPrompt ? (
        <div><button type="button" className="btn primary" onClick={() => void prompt()}><Icon name="install" size={14} />Install Brain</button></div>
      ) : (
        <p className="sub">On iPhone or iPad: Share → Add to Home Screen. On Android or desktop Chrome: the browser’s menu → Install app.</p>
      )}
    </Section>
  );
}

function Appearance() {
  const t = themeStore.use();
  return (
    <Section title="Appearance">
      <div className="seg" role="radiogroup" aria-label="Theme">
        {(['system', 'light', 'dark'] as ThemePref[]).map((x) => (
          <button key={x} type="button" role="radio" aria-checked={t === x} aria-pressed={t === x} onClick={() => themeStore.set(x)}>{x[0]!.toUpperCase() + x.slice(1)}</button>
        ))}
      </div>
    </Section>
  );
}

function MockTools() {
  const { mock, queryClient } = useServices();
  const [down, setDown] = useState(mock?.isServerDown ?? false);
  const toast = useToast();
  if (!mock) return null;
  const reset = (empty: boolean) => { mock.reset(empty); void queryClient.invalidateQueries(); toast(empty ? 'Started empty, like a new account.' : 'Sample data restored.'); };
  return (
    <Section title="Mock server" sub="Only in mock mode. The mock follows the real server’s behaviour, including what it doesn’t do yet.">
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={() => { mock.setServerDown(!down); setDown(!down); }}>{down ? 'Bring server back' : 'Take server down'}</button>
        <button type="button" className="btn" onClick={() => reset(false)}>Reset sample data</button>
        <button type="button" className="btn" onClick={() => reset(true)}>Start empty</button>
      </div>
    </Section>
  );
}
