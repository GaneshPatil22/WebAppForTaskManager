import { useAnswerQuestion, useQuestions } from '../../api/queries';
import { TYPE_LABEL } from '../../domain/labels';
import type { ItemType } from '../../api/types';
import { QueryProblem } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import styles from './shared.module.css';

const optionLabel = (field: string, o: string) => (field === 'type' && o in TYPE_LABEL ? TYPE_LABEL[o as ItemType] : o);

/** Tier T3: Brain asks instead of guessing. One tap, and the answer becomes a label. */
export function QuestionsCard({ limit }: { limit?: number }) {
  const q = useQuestions();
  const answer = useAnswerQuestion();
  const toast = useToast();
  if (q.error) return <section className="card"><h3>Questions</h3><div style={{ marginTop: 10 }}><QueryProblem error={q.error} what="questions" /></div></section>;
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <section className="card">
      <h3><Icon name="question" size={16} />Brain has {list.length === 1 ? 'a question' : `${list.length} questions`}</h3>
      <p className="sub">It wasn’t sure, so it asks instead of guessing.</p>
      {(limit ? list.slice(0, limit) : list).map((x) => (
        <div key={x.id} className={styles.q}>
          <div className={styles.qp}>{x.prompt}</div>
          <div className={styles.opts}>
            {x.options.map((o) => (
              <button key={o} type="button" className="btn sm" disabled={answer.isPending}
                onClick={() => answer.mutate({ id: x.id, answer: { option: o } }, { onSuccess: () => toast('Thanks. Brain will remember.') })}>
                {optionLabel(x.field, o)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
