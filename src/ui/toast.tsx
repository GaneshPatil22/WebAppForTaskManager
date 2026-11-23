import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import styles from './toast.module.css';

interface ToastAction { label: string; run: () => void }
interface Toast { id: number; message: string; action?: ToastAction | undefined }

const Ctx = createContext<(message: string, action?: ToastAction) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action });
    timer.current = setTimeout(() => setToast(null), 5200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className={`${styles.toast} ${toast ? styles.show : ''}`} role="status" aria-live="polite">
        {toast ? (
          <>
            <span>{toast.message}</span>
            {toast.action ? (
              <button type="button" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>
            ) : null}
          </>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
