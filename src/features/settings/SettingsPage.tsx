import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useUpdateTimezone } from '../../api/queries';
import { useServices } from '../../app/services';
import { useAuth } from '../../auth/auth';
import { themeStore, type ThemePref } from '../../app/theme';
import { VIEWS, TODAY_SECTIONS, isOn, setOn, viewPrefsStore } from '../../domain/views';
import { repeatsStore } from '../../local/repeats';
import { plannerStore } from '../../local/planner';
import { focusLogStore, timerStore } from '../../local/timer';
import { InProgress, QueryProblem } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { isApiError } from '../../api/client';
import styles from './settings.module.css';

export function SettingsPage() {
  return (
    <>
      <div className="vhead"><div className="grow"><h1>Settings</h1><p>Your timezone, how Brain looks, and which views you see.</p></div></div>
      <div className={styles.grid}>
        <TimezoneCard />
        <ThemeCard />
        <ViewsCard />
        <ConnectionCard />
        <LocalDataCard />
      </div>
    </>
  );
}

function TimezoneCard() {
  const me = useMe();
  const update = useUpdateTimezone();
  const toast = useToast();
  const zones = useMemo(() => {
    try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return ['Asia/Kolkata', 'UTC']; }
  }, []);
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="card">
      <h3>Timezone</h3>
      <p className="sub">“Today” and every due date are worked out in this zone, wherever you open Brain.</p>
      {me.error ? <div style={{ marginTop: 12 }}><QueryProblem error={me.error} what="your account" /></div> : (
        <div className={styles.stack}>
          <select className="input" value={me.data?.timezone ?? ''} disabled={!me.data || update.isPending} aria-label="Timezone"
            onChange={(e) => update.mutate(e.target.value, {
              onSuccess: () => toast(`Timezone set to ${e.target.value}.`),
              onError: (err) => toast(isApiError(err) ? err.message : 'Couldn’t change the timezone.'),
            })}>
            {!me.data ? <option>Loading…</option> : null}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          {me.data && me.data.timezone !== browser ? (
            <p className="sub">This device is in {browser}. <button className="btn sm" onClick={() => update.mutate(browser)}>Use {browser}</button></p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ThemeCard() {
  const t = themeStore.use();
  return (
    <section className="card">
      <h3>Appearance</h3>
      <p className="sub">Kept on this device.</p>
      <div className={styles.seg} role="radiogroup" aria-label="Theme">
        {(['system', 'light', 'dark'] as ThemePref[]).map((x) => (
          <button key={x} role="radio" aria-checked={t === x} className={t === x ? styles.on : ''} onClick={() => themeStore.set(x)}>
            {x === 'system' ? 'Match device' : x === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </section>
  );
}

function Toggle({ id, on, label, status, note }: { id: string; on: boolean; label: string; status: 'live' | 'in-progress'; note: string }) {
  return (
    <li className={styles.toggle}>
      <div>
        <div className={styles.tl}>{label} {status === 'in-progress' ? <InProgress /> : null}</div>
        <div className="sub">{note}</div>
      </div>
      <button className={styles.switch} aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${label}`} onClick={() => setOn(id as never, !on)} />
    </li>
  );
}

function ViewsCard() {
  const prefs = viewPrefsStore.use();
  return (
    <section className={`card ${styles.wide}`}>
      <h3>Views</h3>
      <p className="sub">Switch off what you don’t use. <span className="wip">In progress</span> means it works on this device only, because the Brain server doesn’t have it yet.</p>
      <div className={styles.cols}>
        <div>
          <h4>Pages</h4>
          <ul>
            {VIEWS.filter((v) => !v.core).map((v) => <Toggle key={v.id} id={v.id} on={isOn(prefs, v.id)} label={v.title} status={v.status} note={v.description} />)}
          </ul>
        </div>
        <div>
          <h4>On the Today page</h4>
          <ul>
            {TODAY_SECTIONS.map((s) => <Toggle key={s.id} id={s.id} on={isOn(prefs, s.id)} label={s.title} status={s.status} note={s.description} />)}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ConnectionCard() {
  const { config, mock } = useServices();
  const { auth, state } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [down, setDown] = useState(mock?.isServerDown ?? false);
  return (
    <section className="card">
      <h3>Connection</h3>
      {config.apiMode === 'mock' ? (
        <>
          <p className="sub">Running against the <b>mock server</b>: a fake Brain inside this browser, following the same API contract. Nothing leaves this device.</p>
          <p className="sub" style={{ marginTop: 10 }}><b>Server down</b> makes every call fail with 503. Captures wait safely on this device and send when it comes back. {down ? <span className="chip danger">Down now</span> : null}</p>
          <div className={styles.row}>
            <button className="btn sm" onClick={() => { mock!.setServerDown(!down); setDown(!down); if (down) { void qc.invalidateQueries(); } }}>{down ? 'Bring server back' : 'Take server down'}</button>
            <button className="btn sm" onClick={() => { if (confirm('Reset the mock server to its sample data?')) { mock!.reset(); void qc.invalidateQueries(); toast('Sample data restored.'); } }}>Reset sample data</button>
            <button className="btn sm" onClick={() => { if (confirm('Start the mock server empty?')) { mock!.reset(true); void qc.invalidateQueries(); toast('Mock server is empty.'); } }}>Start empty</button>
          </div>
        </>
      ) : (
        <>
          <p className="sub">Connected to the Brain server at <code>{config.apiBaseUrl || window.location.origin}</code>.</p>
          {state.status === 'signedIn' ? <p className="sub">Signed in as {state.email ?? 'you'}.</p> : null}
          <div className={styles.row}><button className="btn sm" onClick={() => void auth.signOut()}>Sign out</button></div>
        </>
      )}
    </section>
  );
}

function LocalDataCard() {
  const toast = useToast();
  return (
    <section className="card">
      <h3>Data on this device <InProgress /></h3>
      <p className="sub">Repeats, timers, focus history and day plans live in this browser until the server supports them. Clearing them can’t be undone.</p>
      <div className={styles.row}>
        <button className="btn sm danger" onClick={() => {
          if (!confirm('Clear repeats, focus history, timer and day plans from this device?')) return;
          repeatsStore.set([]); focusLogStore.reset(); timerStore.reset(); plannerStore.reset();
          toast('Device-only data cleared.');
        }}>Clear device-only data</button>
      </div>
    </section>
  );
}
