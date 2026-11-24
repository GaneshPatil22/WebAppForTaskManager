import { Link } from '@tanstack/react-router';
import { CaptureComposer } from './CaptureComposer';
import styles from './capture.module.css';

/** Text shared into the installed app (Android's share sheet) arrives as ?title=&text=&url=. */
function shared(): string | undefined {
  const q = new URLSearchParams(window.location.search);
  const parts = [q.get('title'), q.get('text'), q.get('url')].map((x) => x?.trim()).filter((x): x is string => !!x);
  return parts.length ? [...new Set(parts)].join('\n') : undefined;
}

/** Capture as a page: what the installed app's "Capture" shortcut and share target open, online or not. */
export function CapturePage() {
  const fromShare = shared();
  return (
    <div className={styles.page}>
      <div className="page-head"><div className="grow">
        <h1>Capture</h1>
        <p>Get it out of your head. Brain sorts it; you decide later. <Link to="/inbox">See the inbox</Link></p>
      </div></div>
      <CaptureComposer big initial={fromShare} source={fromShare ? 'share' : 'text'} />
    </div>
  );
}
