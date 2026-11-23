import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Icon } from '../ui/Icon';
import { useServices, useOutbox } from './services';
import { useEnrichmentWatcher, useCaptures, useQuestions, useSuggestions } from '../api/queries';
import { VIEWS, isOn, viewPrefsStore } from '../domain/views';
import { MAX_CAPTURE_CHARS } from '../outbox/outbox';
import { useToast } from '../ui/toast';
import { themeStore, effectiveDark, useApplyTheme } from './theme';
import { TimerPill, TimerRunner } from '../features/timer/Timer';
import { ItemSheetProvider } from './itemSheet';
import styles from './shell.module.css';

export function Shell() {
  useApplyTheme();
  useEnrichmentWatcher();
  const prefs = viewPrefsStore.use();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { config } = useServices();
  const inboxCount = useInboxCount();

  return (
    <ItemSheetProvider>
      <div className={styles.app}>
        <nav className={styles.nav} aria-label="Main">
          <div className={styles.logo}><i><Icon name="brain" size={18} /></i>Brain</div>
          {VIEWS.filter((v) => isOn(prefs, v.id)).map((v) => (
            <Link key={v.id} to={v.path} className={path === v.path ? styles.on : undefined}>
              <Icon name={v.icon} size={20} />
              <span>{v.title}</span>
              {v.id === 'inbox' && inboxCount ? <span className={styles.badge}>{inboxCount}</span> : null}
              {v.status === 'in-progress' ? <span className={styles.dot} title="In progress" /> : null}
            </Link>
          ))}
          <Link to="/settings" className={`${styles.settings} ${path === '/settings' ? styles.on : ''}`}>
            <Icon name="settings" size={20} /><span>Settings</span>
          </Link>
        </nav>
        <div className={styles.main}>
          <header className={styles.top}>
            <CaptureBar />
            {isOn(prefs, 'timer') ? <TimerPill /> : null}
            {config.apiMode === 'mock' ? <span className={`chip accent ${styles.mockChip}`} title="Data comes from the in-browser mock server">Mock data</span> : null}
            <span style={{ flex: 1 }} className={styles.spacer} />
            <ThemeButton />
          </header>
          <SyncStrip />
          <main className={styles.page}><Outlet /></main>
        </div>
      </div>
      <TimerRunner />
    </ItemSheetProvider>
  );
}

function useInboxCount(): number {
  const q = useQuestions();
  const s = useSuggestions();
  const outbox = useOutbox();
  return (q.data?.length ?? 0) + (s.data?.length ?? 0) + outbox.length;
}

function CaptureBar() {
  const { outbox } = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName ?? '';
      if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(t) && !(document.activeElement as HTMLElement | null)?.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const onFocusCapture = () => input.current?.focus();
    window.addEventListener('brain:focus-capture', onFocusCapture);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('brain:focus-capture', onFocusCapture); };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    if ([...v].length > MAX_CAPTURE_CHARS) {
      toast(`That’s over ${MAX_CAPTURE_CHARS.toLocaleString()} characters. Split it into smaller captures.`);
      return;
    }
    setText('');
    await outbox.enqueue(v, 'text');
    toast('Captured. Brain is organising it.', { label: 'Open inbox', run: () => { void navigate({ to: '/inbox' }); } });
  }

  return (
    <form className={styles.cap} onSubmit={submit} autoComplete="off">
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Dump anything: a task, idea, link… (press / to focus)" aria-label="Capture anything" />
      <button className="btn primary" type="submit">Capture</button>
    </form>
  );
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
        <div className="banner danger">
          <Icon name="cloudOff" size={15} />
          <span>
            {pending.length
              ? `${pending.length} capture${pending.length === 1 ? '' : 's'} saved on this device, waiting for Brain. Nothing is lost.`
              : 'Can’t reach Brain right now.'}
          </span>
          {pending.length ? <button className="btn sm" onClick={() => outbox.retryNow()}>Retry now</button> : null}
        </div>
      ) : pending.length ? (
        <div className="banner info"><span className="spin"><Icon name="refresh" size={14} /></span><span>Saving {pending.length} capture{pending.length === 1 ? '' : 's'}…</span></div>
      ) : null}
      {rejected.length ? (
        <div className="banner danger"><span>{rejected.length} capture{rejected.length === 1 ? ' was' : 's were'} refused by the server. See the Inbox.</span><Link to="/inbox" className="btn sm">Open inbox</Link></div>
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

export function focusCapture() {
  window.dispatchEvent(new Event('brain:focus-capture'));
}
