import { useEffect, useRef, useState } from 'react';
import type { Effort, Item } from '../../api/types';
import { useUpdateItem } from '../../api/queries';
import { decidedByLabel, EFFORT_SHORT, SIZE_CHIP, SIZES } from '../../domain/labels';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import styles from './sizeChip.module.css';

/**
 * An item's size, changeable in one tap. Brain's size guesses are often
 * wrong (the model's median confidence is about 0.39), so a guess looks
 * like one, and correcting it is right on the row. Every change is sent as
 * your decision, which the server records as a correction.
 */
export function SizeChip({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const update = useUpdateItem();
  const toast = useToast();
  const value = item.effort.value && item.effort.value !== 'unknown' ? item.effort.value : undefined;
  const who = decidedByLabel(item.effort.decidedBy);
  const guess = !!value && who.suggested;
  // A model's size (t1, t2) is the weak one: it says "guess" in words. A
  // rule's size (t0) came from a duration you wrote, so it is only marked.
  const model = guess && (item.effort.decidedBy === 't1' || item.effort.decidedBy === 't2');

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (effort: Effort) => {
    setOpen(false);
    if (effort === value && !guess) return;
    update.mutate({ id: item.id, update: { effort } }, {
      onSuccess: () => toast(`Size set to ${SIZE_CHIP[effort]}.`),
      onError: (e) => toast(errorText(e, 'Couldn’t change the size.')),
    });
  };

  const said = value ? `${EFFORT_SHORT[value]}, ${guess ? who.text.toLowerCase() : 'you set'}` : 'not known';
  return (
    <span className={styles.wrap} ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Size: ${said}. Change size of ${item.title}`}
        title={guess ? `${who.long} Tap to correct.` : 'Change size'}
        className={`${styles.chip} ${!value ? styles.unknown : model ? styles.model : guess ? styles.guess : styles.yours}`}
        onClick={() => setOpen((o) => !o)}>
        {value ? SIZE_CHIP[value] : 'Size?'}
        {model ? <span className={styles.mark}>guess</span> : null}
      </button>
      {open ? (
        <span className={styles.menu} role="menu" aria-label="Size">
          {SIZES.map((s) => (
            <button key={s} type="button" role="menuitemradio" aria-checked={s === value && !guess}
              className={s === value ? styles.current : undefined} onClick={() => pick(s)}>
              {EFFORT_SHORT[s]}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
