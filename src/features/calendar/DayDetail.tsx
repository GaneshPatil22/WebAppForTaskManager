import { Link } from '@tanstack/react-router';
import { useItemsById } from '../../api/queries';
import { useOpenItem } from '../../app/itemSheet';
import { OccurrenceRow } from '../commitments/OccurrenceRow';
import { JournalEditor } from '../journal/JournalEditor';
import { ItemRow } from '../items/ItemRow';
import type { DayData } from './useDays';
import type { DayKey } from '../../domain/time';
import styles from './calendar.module.css';

/** One day in full: its commitments, big task, what's due, and the journal. */
export function DayDetail({ d, today }: { d: DayData; today: DayKey }) {
  const byId = useItemsById();
  const open = useOpenItem();
  const big = d.bigTask ? byId.get(d.bigTask.itemId) : undefined;
  return (
    <div className={styles.detail}>
      {d.bigTask ? (
        <div>
          <h3 className={styles.dh}>Big task</h3>
          <button type="button" className="link-btn" style={{ color: 'var(--ink)', fontSize: 15 }} onClick={() => big && open(big.id)}>{big?.title ?? 'An item'}</button>
          {d.bigTask.swapped ? <span className="sub"> · swapped from Brain’s pick</span> : null}
        </div>
      ) : null}
      <div>
        <h3 className={styles.dh}>Committed</h3>
        {d.occurrences.length ? (
          <ul>{d.occurrences.map((o) => <OccurrenceRow key={`${o.commitment.id}|${o.day}|${o.place}`} o={o} today={today} />)}</ul>
        ) : <p className="sub">Nothing scheduled.</p>}
      </div>
      {d.due.length ? (
        <div>
          <h3 className={styles.dh}>Due</h3>
          <div>{d.due.map((i) => <ItemRow key={i.id} item={i} />)}</div>
        </div>
      ) : null}
      <div>
        <h3 className={styles.dh}>Journal</h3>
        {d.day <= today ? <JournalEditor day={d.day} entry={d.journal} /> : <p className="sub">You can write once the day comes. <Link to="/journal">Journal</Link></p>}
      </div>
    </div>
  );
}
