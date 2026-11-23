import { Link } from '@tanstack/react-router';
import type { Edge } from '../../api/types';
import { useConfirmEdge, useGoalsById, useItemsById, useRejectEdge, useSuggestions } from '../../api/queries';
import { EDGE_PHRASE, confidenceWord } from '../../domain/labels';
import { isApiError } from '../../api/client';
import { QueryProblem } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { useOpenItem } from '../../app/itemSheet';
import styles from './shared.module.css';

const WHY: Record<Edge['kind'], string> = {
  duplicate: 'They look like the same thing written twice.',
  blocks: 'Your words suggest one has to happen first.',
  relates: 'They look related.',
  serves: 'It looks like it serves this goal.',
};

export function SuggestionCard({ edge }: { edge: Edge }) {
  const items = useItemsById();
  const goals = useGoalsById();
  const confirm = useConfirmEdge();
  const reject = useRejectEdge();
  const toast = useToast();
  const open = useOpenItem();
  const from = items.get(edge.from);
  const to = edge.kind === 'serves' ? goals.get(edge.to) : items.get(edge.to);
  const word = confidenceWord(edge.confidence);
  return (
    <div className={styles.sug}>
      <div className={styles.conf}><span className={`chip ${word === 'Likely' ? 'accent' : ''}`}>{word}</span><span className="sub">Not confirmed yet</span></div>
      <div className={styles.sline}>
        <button type="button" onClick={() => from && open(from.id)}>{from?.title ?? '…'}</button>
        <span className={styles.rel}>{EDGE_PHRASE[edge.kind]}</span>
        <button type="button" onClick={() => edge.kind !== 'serves' && to && open(to.id)}>{to?.title ?? '…'}</button>
      </div>
      <div className="sub">{WHY[edge.kind]}</div>
      <div className={styles.sact}>
        <button type="button" className="btn sm primary" disabled={confirm.isPending}
          onClick={() => confirm.mutate(edge.id, {
            onSuccess: () => toast(edge.kind === 'duplicate' ? 'Marked as a duplicate.' : 'Link confirmed. Your plan updates.'),
            onError: (e) => toast(isApiError(e) && e.code === 'cycle' ? 'Confirming that would make a loop, so Brain refused it.' : 'Couldn’t confirm. Try again.'),
          })}>Confirm</button>
        <button type="button" className="btn sm" disabled={reject.isPending}
          onClick={() => reject.mutate(edge.id, { onSuccess: () => toast('Dismissed. Brain won’t suggest it again.') })}>Dismiss</button>
      </div>
    </div>
  );
}

export function SuggestionsCard({ limit }: { limit?: number }) {
  const s = useSuggestions();
  if (s.error) return <section className="card"><h3>Link suggestions</h3><div style={{ marginTop: 10 }}><QueryProblem error={s.error} what="link suggestions" /></div></section>;
  const list = s.data ?? [];
  if (!list.length) return null;
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <section className="card">
      <h3>Link suggestions</h3>
      <p className="sub">{list.length} waiting. Dashed means unconfirmed: it doesn’t count in your plan until you confirm.</p>
      <div className={limit ? undefined : styles.sgrid}>{shown.map((e) => <SuggestionCard key={e.id} edge={e} />)}</div>
      {limit && list.length > limit ? <p className="sub" style={{ marginTop: 10 }}><Link to="/inbox">See all {list.length} in the Inbox</Link></p> : null}
    </section>
  );
}
