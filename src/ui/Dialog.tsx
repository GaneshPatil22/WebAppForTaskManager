import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './dialog.module.css';

/** A native <dialog>: focus trapping, Escape and the backdrop come free. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.wide : ''}`} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open ? (
        <div className={styles.body}>
          <header className={styles.head}>
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
