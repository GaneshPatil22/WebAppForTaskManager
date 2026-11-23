import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { isApiError } from '../api/client';

/** Marks anything not backed by the Brain server yet. Always visible, never hidden in a tooltip. */
export function InProgress({ note = 'Works on this device only. The server does not have this yet.' }: { note?: string }) {
  return <span className="wip" title={note}>In progress</span>;
}

export function Ring({ value, size = 64, stroke = 7, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .3s linear' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

/**
 * Shows a failed query honestly. A 501 is not an error the user caused:
 * it says the server has not built this yet.
 */
export function QueryProblem({ error, what, onRetry }: { error: unknown; what: string; onRetry?: () => void }) {
  if (isApiError(error) && error.kind === 'notImplemented') {
    return (
      <div className="banner">
        <Icon name="lock" size={15} />
        <span>The Brain server doesn’t serve {what} yet. It is coming in a later server step.</span>
      </div>
    );
  }
  if (isApiError(error) && error.kind === 'unavailable') {
    return (
      <div className="banner danger">
        <Icon name="cloudOff" size={15} />
        <span>Can’t reach Brain right now. Your captures are safe on this device.</span>
        {onRetry ? <button className="btn sm" onClick={onRetry}>Try again</button> : null}
      </div>
    );
  }
  return (
    <div className="banner danger">
      <span>Couldn’t load {what}{isApiError(error) ? `: ${error.message}` : ''}.</span>
      {onRetry ? <button className="btn sm" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} style={{ padding: '14px 16px', display: 'flex', gap: 10 }}>
          <span className="shimmer" style={{ width: '45%' }} /><span className="shimmer" /><span className="shimmer" style={{ width: 40 }} />
        </li>
      ))}
    </ul>
  );
}
