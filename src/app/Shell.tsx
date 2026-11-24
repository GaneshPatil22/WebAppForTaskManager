import { useEffect, useState } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Icon, type IconKey } from '../ui/Icon';
import { Dialog } from '../ui/Dialog';
import { useServices, useOutbox } from './services';
import { useEnrichmentWatcher, useCaptures, useSuggestions } from '../api/queries';
import { themeStore, effectiveDark, useApplyTheme } from './theme';
import { prefsStore } from './prefs';
import { ItemSheetProvider } from './itemSheet';
import { CaptureComposer } from '../features/capture/CaptureComposer';
import { TimerDock, TimerPill, TimerRunner } from '../features/timer/Timer';
import { RemindersRunner } from '../pwa/RemindersRunner';
import { PlannedRunner } from '../features/today/PlannedRunner';
import styles from './shell.module.css';

interface NavDef { to: string; label: string; icon: IconKey }
const GROUPS: { title: string; items: NavDef[] }[] = [
  { title: 'Plan', items: [
    { to: '/', label: 'Today', icon: 'today' },
    { to: '/week', label: 'Week', icon: 'week' },
    { to: '/month', label: 'Month', icon: 'month' },
  ] },
  { title: 'Look back', items: [
    { to: '/review', label: 'Review', icon: 'review' },
    { to: '/journal', label: 'Journal', icon: 'journal' },
  ] },
  { title: 'Decide', items: [
    { to: '/goals', label: 'Goals', icon: 'goal' },
    { to: '/commitments', label: 'Commitments', icon: 'repeat' },
  ] },
  { title: 'Captured', items: [
    { to: '/inbox', label: 'Inbox', icon: 'inbox' },
    { to: '/items', label: 'All items', icon: 'list' },
  ] },
];

export function Shell() {
  useApplyTheme();
  useEnrichmentWatcher();
  const prefs = prefsStore.use();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { config } = useServices();
  const inboxCount = useInboxCount();
  const [capturing, setCapturing] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(el?.tagName ?? '') && !el?.isContentEditable && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCapturing(true);
      }
    };
    const open = () => setCapturing(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('brain:capture', open);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('brain:capture', open); };
  }, []);
  useEffect(() => setMore(false), [path]);

  const navLink = (n: NavDef, cls?: string) => (
    <Link key={n.to} to={n.to} className={`${cls ?? ''} ${path === n.to ? styles.on : ''}`}>
      <Icon name={n.icon} size={18} />
      <span>{n.label}</span>
      {n.to === '/inbox' && inboxCount ? <span className={styles.badge}>{inboxCount}</span> : null}
    </Link>
  );

  return (
    <ItemSheetProvider>
      <div className={styles.app}>
        <nav className={styles.side} aria-label="Main">
          <Link to="/" className={styles.logo}><i><Icon name="brain" size={16} /></i>Brain</Link>
          {GROUPS.map((g) => (
            <div key={g.title} className={styles.group}>
              <div className={styles.groupTitle}>{g.title}</div>
              {g.items.map((n) => navLink(n))}
            </div>
          ))}
          {prefs.timer ? <TimerDock variant="side" /> : null}
          <div className={styles.sideFoot}>{navLink({ to: '/settings', label: 'Settings', icon: 'settings' })}</div>
        </nav>

        <div className={styles.main}>
          <header className={styles.top}>
            <button type="button" className={styles.capTrigger} onClick={() => setCapturing(true)} aria-label="Capture anything">
              <Icon name="plus" size={16} />
              <span>Dump anything…</span>
              <kbd>/</kbd>
            </button>
            <span className={styles.spacer} />
            {prefs.timer ? <TimerPill /> : null}
            {config.apiMode === 'mock' ? <span className={`chip ${styles.mock}`} title="Data comes from the in-browser mock server">Mock data</span> : null}
            <ThemeButton />
          </header>
          <SyncStrip />
          {prefs.timer ? <TimerDock variant="strip" /> : null}
          <main className={styles.page}><Outlet /></main>
        </div>

        <nav className={styles.bottom} aria-label="Main (mobile)">
          {navLink({ to: '/', label: 'Today', icon: 'today' })}
          {navLink({ to: '/week', label: 'Week', icon: 'week' })}
          <button type="button" className={styles.fab} onClick={() => setCapturing(true)} aria-label="Capture anything"><Icon name="plus" size={22} /></button>
          {navLink({ to: '/inbox', label: 'Inbox', icon: 'inbox' })}
          <button type="button" className={styles.moreBtn} onClick={() => setMore(true)}><Icon name="more" size={18} /><span>More</span></button>
        </nav>
      </div>

      <Dialog open={capturing} onClose={() => setCapturing(false)} title="Capture">
        <CaptureComposer onDone={() => setCapturing(false)} />
      </Dialog>
      <Dialog open={more} onClose={() => setMore(false)} title="Brain">
        <div className={styles.moreList}>
          {GROUPS.flatMap((g) => g.items).filter((n) => !['/', '/week', '/inbox'].includes(n.to)).map((n) => navLink(n))}
          {navLink({ to: '/settings', label: 'Settings', icon: 'settings' })}
        </div>
      </Dialog>
      <TimerRunner />
      <RemindersRunner />
      <PlannedRunner />
    </ItemSheetProvider>
  );
}

/** Things in the inbox that need you: unsent or refused captures, and suggested links. */
function useInboxCount(): number {
  const s = useSuggestions();
  const outbox = useOutbox();
  return (s.data?.length ?? 0) + outbox.length;
}

/** Says, without alarm, when captures are waiting to reach the server. */
function SyncStrip() {
  const rows = useOutbox();
  const { outbox } = useServices();
  const caps = useCaptures();
  const pending = rows.filter((r) => r.state === 'pending');
  const rejected = rows.filter((r) => r.state === 'rejected');
  const failing = pending.some((r) => r.attempts > 0);
  const serverDown = caps.error !== null && caps.error !== undefined;
  if (!pending.length && !rejected.length && !serverDown) return null;
  return (
    <div className={styles.strip}>
      {failing || serverDown ? (
        <div className="banner">
          <Icon name="cloudOff" size={15} />
          <span>
            {pending.length
              ? `${pending.length} capture${pending.length === 1 ? '' : 's'} saved on this device, waiting for Brain. Nothing is lost.`
              : 'Can’t reach Brain right now. Anything you capture is kept on this device.'}
          </span>
          {pending.length ? <button className="btn sm" onClick={() => outbox.retryNow()}>Retry now</button> : null}
        </div>
      ) : pending.length ? (
        <div className="banner info"><span className="spin"><Icon name="refresh" size={14} /></span><span>Saving {pending.length} capture{pending.length === 1 ? '' : 's'}…</span></div>
      ) : null}
      {rejected.length ? (
        <div className="banner danger"><span>{rejected.length} capture{rejected.length === 1 ? ' was' : 's were'} refused by the server. They’re kept in the Inbox.</span><Link to="/inbox" className="btn sm">Open inbox</Link></div>
      ) : null}
    </div>
  );
}

function ThemeButton() {
  const t = themeStore.use();
  const dark = effectiveDark(t);
  return (
    <button type="button" className="icon-btn" onClick={() => themeStore.set(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

/** Opens the capture dialog from anywhere. */
export function openCapture() {
  window.dispatchEvent(new Event('brain:capture'));
}
