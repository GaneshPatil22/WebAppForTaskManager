import type { Goal } from '../../api/types';
import { Icon } from '../../ui/Icon';
import styles from './goals.module.css';

const STATUS: Record<Goal['status'], string> = { active: '', achieved: 'Achieved', abandoned: 'Let go' };

/** A goal in one line. Goals are only ever the user's own. */
export function GoalLine({ goal, parent }: { goal: Goal; parent?: Goal | undefined }) {
  return (
    <li className={`${styles.line} ${goal.status !== 'active' ? styles.closed : ''}`}>
      <Icon name={goal.status === 'achieved' ? 'check' : 'goal'} size={14} />
      <span className={styles.lineTitle}>{goal.title}</span>
      {goal.targetCount !== undefined ? <span className="sub">{goal.doneCount ?? 0} of {goal.targetCount}</span> : null}
      {STATUS[goal.status] ? <span className="chip">{STATUS[goal.status]}</span> : null}
      {parent ? <span className="sub">→ {parent.title}</span> : null}
    </li>
  );
}
