import { useEffect, useState } from 'react';
import type { JournalEntry } from '../../api/types';
import { useWriteJournal } from '../../api/queries';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import type { DayKey } from '../../domain/time';
import styles from './journal.module.css';

/**
 * One entry per day, three lines is plenty. Not an item: it never ranks,
 * never blocks, has no status. Saving replaces the day's text.
 */
export function JournalEditor({ day, entry, autoFocus = false, onSaved, placeholder }: {
  day: DayKey; entry: JournalEntry | undefined; autoFocus?: boolean; onSaved?: () => void; placeholder?: string;
}) {
  const write = useWriteJournal();
  const toast = useToast();
  const [body, setBody] = useState(entry?.body ?? '');
  useEffect(() => setBody(entry?.body ?? ''), [entry?.body]);
  const dirty = body.trim() !== (entry?.body ?? '').trim();

  const save = () => {
    const text = body.trim();
    if (!text && !entry) return;
    write.mutate({ day, body: text || null }, {
      onSuccess: () => { toast(text ? 'Saved to your journal.' : 'Entry deleted.'); onSaved?.(); },
      onError: (e) => toast(errorText(e, 'Couldn’t save the entry.')),
    });
  };

  return (
    <div className={styles.editor}>
      <textarea className={`input ${styles.area}`} rows={3} value={body} maxLength={2000} autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)} aria-label="Journal entry"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
        placeholder={placeholder ?? 'Three lines about today. What happened, how it felt, one thing for tomorrow.'} />
      {dirty ? (
        <div className="form-actions">
          {entry ? <button type="button" className="btn sm quiet" onClick={() => setBody(entry.body)}>Cancel</button> : null}
          <button type="button" className="btn sm primary" onClick={save} disabled={write.isPending}>{body.trim() ? 'Save' : 'Delete entry'}</button>
        </div>
      ) : null}
    </div>
  );
}
