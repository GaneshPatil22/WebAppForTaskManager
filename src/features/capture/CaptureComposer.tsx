import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useServices } from '../../app/services';
import { MAX_CAPTURE_CHARS } from '../../outbox/outbox';
import { useToast } from '../../ui/toast';
import type { CaptureSource } from '../../api/types';
import { canSplit, splitLines } from './split';
import styles from './capture.module.css';

const DRAFT_KEY = 'brain-capture-draft';
const readDraft = () => { try { return localStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; } };
const writeDraft = (v: string) => { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ } };

/**
 * The front door. Takes a long dump, not one line: paste a whole list, or
 * think out loud. Every capture reaches IndexedDB before the network, so
 * this works offline and nothing typed here is lost. The unsent draft is
 * kept too, in case the tab closes mid-thought.
 */
export function CaptureComposer({ onDone, autoFocus = true, big = false, initial, source = 'text' }: {
  onDone?: () => void; autoFocus?: boolean; big?: boolean; initial?: string | undefined; source?: CaptureSource;
}) {
  const { outbox } = useServices();
  const toast = useToast();
  const [text, setText] = useState(() => initial ?? readDraft());
  const [split, setSplit] = useState(source !== 'share'); // a shared page is one thing, not a list
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => writeDraft(text), [text]);

  const lines = splitLines(text);
  const splitting = split && canSplit(text);
  const parts = splitting ? lines : text.trim() ? [text.trim()] : [];
  const tooLong = parts.find((p) => [...p].length > MAX_CAPTURE_CHARS);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!parts.length || tooLong || saving) return;
    setSaving(true);
    try {
      // In order, so captures keep the order they were written in.
      for (const p of parts) await outbox.enqueue(p, source);
      setText('');
      toast(parts.length === 1 ? 'Captured. Brain is organising it.' : `Captured ${parts.length} things. Brain is organising them.`);
      onDone?.();
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <textarea ref={ref} className={`${styles.area} ${big ? styles.big : ''}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
        aria-label="Capture anything" placeholder={'Dump anything. One thought or a whole list:\ncall CA about advance tax kal\nrent 22k on the 4th\nidea: reels on graph algorithms'} />
      <div className={styles.bar}>
        {canSplit(text) ? (
          <label className="check">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            <span>One capture per line <span className="muted">({lines.length})</span></span>
          </label>
        ) : <span className="sub">Saved on this device first, so it works offline.</span>}
        <span style={{ flex: 1 }} />
        <span className={`sub ${styles.hint}`}>⌘ Enter</span>
        <button className="btn primary" type="submit" disabled={!parts.length || !!tooLong || saving}>
          {parts.length > 1 ? `Capture ${parts.length}` : 'Capture'}
        </button>
      </div>
      {tooLong ? <p className="banner danger">One capture can be at most {MAX_CAPTURE_CHARS.toLocaleString()} characters. Split it up.</p> : null}
    </form>
  );
}
