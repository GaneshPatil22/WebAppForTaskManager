import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { isApiError } from '../api/client';
import type { DecidedBy } from '../api/types';
import { decidedByLabel } from '../domain/labels';
import { textForCode } from '../domain/errors';
import styles from './components.module.css';

/**
 * Who decided a value. Brain's guesses are dashed and amber with a spark;
 * your decisions are solid ink. The two never look alike.
 */
export function Decided({ by, has = true }: { by: DecidedBy; has?: boolean }) {
  if (!has) return <span className="chip guess" title="Brain left this blank rather than guess">Not decided</span>;
  const l = decidedByLabel(by);
  return l.suggested
    ? <span className="chip guess" title={l.long}><Icon name="spark" size={11} />{l.text}</span>
    : <span className="chip yours" title={l.long}>{l.text}</span>;
}

/** A value shown inline, marked if it is Brain's guess rather than yours. */
export function Val({ by, children }: { by: DecidedBy; children: ReactNode }) {
  const guess = decidedByLabel(by).suggested;
  return <span className={guess ? styles.guessVal : undefined} title={guess ? 'Brain’s guess. Tap the item to change it.' : undefined}>{children}</span>;
}

/** Says plainly that something is Brain's proposal, waiting for you. */
export function ProposalTag({ children = 'Brain proposes' }: { children?: ReactNode }) {
  return <span className={styles.proposalTag}><Icon name="spark" size={12} />{children}</span>;
}

/**
 * A failed query, said honestly. 503 or no network is "can't reach", never
 * "you're signed out"; captures stay safe on the device either way.
 */
export function QueryProblem({ error, what, onRetry }: { error: unknown; what: string; onRetry?: () => void }) {
  if (isApiError(error) && error.kind === 'notImplemented') {
    return <div className="banner"><Icon name="lock" size={15} /><span>The Brain server doesn’t serve {what} yet.</span></div>;
  }
  if (isApiError(error) && error.kind === 'unavailable') {
    return (
      <div className="banner danger">
        <Icon name="cloudOff" size={15} />
        <span>Can’t reach Brain for {what}. Captures you make are safe on this device.</span>
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
    <div aria-busy="true" aria-label="Loading" className={styles.skeleton}>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="shimmer" style={{ width: `${70 - i * 12}%` }} />)}
    </div>
  );
}

/** The message from an API error, in words a person can act on. */
export function errorText(e: unknown, fallback = 'Something went wrong.'): string {
  if (!isApiError(e)) return fallback;
  if (e.kind === 'unavailable') return 'Can’t reach Brain right now. Try again in a moment.';
  return textForCode(e.code) ?? (e.message || fallback);
}
