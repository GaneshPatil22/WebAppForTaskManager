import { Link } from '@tanstack/react-router';
import type { Question } from '../../api/types';
import { useAnswerQuestion, useItemsById, useQuestions } from '../../api/queries';
import { useOpenItem } from '../../app/itemSheet';
import { createLocalStore } from '../../local/store';
import { Icon } from '../../ui/Icon';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { isApiError } from '../../api/client';
import { TYPE_LABEL } from '../../domain/labels';
import { ITEM_TYPES, type ItemType } from '../../api/types';
import styles from './questions.module.css';

/**
 * Brain's questions (tier T3): asked when it can't tell what kind of thing
 * a capture is, rather than guessing. One tap answers; the answer becomes
 * your decision. The item works normally while a question is open, and
 * nothing here renders when there are none.
 */

/** Questions hidden from Today on this device. Hiding never answers one. */
const hidden = createLocalStore<string[]>('brain-questions-hidden-v1', () => []);

/** The option's label. Options are the server's; an unfamiliar one shows as sent. */
const optionLabel = (q: Question, o: string) =>
  q.field === 'type' && (ITEM_TYPES as readonly string[]).includes(o) ? TYPE_LABEL[o as ItemType] : o;

function QuestionCard({ q, onHide, more = 0, compact = false }: { q: Question; onHide?: () => void; more?: number; compact?: boolean }) {
  const answer = useAnswerQuestion();
  const openItem = useOpenItem();
  const toast = useToast();
  const byId = useItemsById();
  const item = byId.get(q.itemId);
  const pick = (option: string) => answer.mutate({ q, option }, {
    onSuccess: () => toast(`Saved as ${optionLabel(q, option).toLowerCase()}.`),
    onError: (e) => {
      if (isApiError(e) && e.code === 'already_answered') toast(errorText(e), { label: 'Edit item', run: () => openItem(q.itemId) });
      else if (!(isApiError(e) && e.status === 404)) toast(errorText(e, 'Couldn’t save the answer.'));
    },
  });
  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''}`}>
      <div className={styles.head}>
        <span className={styles.tag}><Icon name="spark" size={12} />Brain has a question</span>
        {more ? <Link to="/inbox" className={styles.more}>+{more} more</Link> : null}
        <span className="grow" />
        {onHide ? <button type="button" className="icon-btn" aria-label="Hide this question" title="Hide here (it stays in Inbox)" onClick={onHide}><Icon name="close" size={14} /></button> : null}
      </div>
      <p className={styles.prompt}>{q.prompt}</p>
      <div className={styles.options} role="group" aria-label={q.prompt}>
        {q.options.map((o) => (
          <button key={o} type="button" className="btn sm" disabled={answer.isPending} onClick={() => pick(o)}>{optionLabel(q, o)}</button>
        ))}
      </div>
      {item && !compact ? (
        <p className={styles.foot}>
          Brain couldn’t tell, so it left this blank instead of guessing.{' '}
          <button type="button" className="link-btn" onClick={() => openItem(item.id)}>Open item</button>
        </p>
      ) : null}
    </div>
  );
}

/** Today: one question at a time, hideable. */
export function TodayQuestion() {
  const q = useQuestions();
  const gone = hidden.use();
  const rows = (q.data ?? []).filter((x) => !gone.includes(x.id));
  const first = rows[0];
  if (!first) return null;
  const hide = () => {
    const live = new Set((q.data ?? []).map((x) => x.id));
    hidden.set((h) => [...h.filter((id) => live.has(id)), first.id]);
  };
  return (
    <section aria-label="Brain has a question" className={styles.today}>
      <QuestionCard q={first} onHide={hide} more={rows.length - 1} compact />
    </section>
  );
}

/** Inbox: all of them, newest first, as the server sends them. */
export function InboxQuestions() {
  const q = useQuestions();
  if (!q.data?.length) return null;
  return (
    <section aria-label="Brain’s questions" className={styles.inbox}>
      <div className="section-head" style={{ marginTop: 0 }}><h2>Brain asks</h2><span className="grow sub">One tap each. Skip any; nothing waits on them.</span></div>
      <div className={styles.stack}>{q.data.map((x) => <QuestionCard key={x.id} q={x} />)}</div>
    </section>
  );
}
