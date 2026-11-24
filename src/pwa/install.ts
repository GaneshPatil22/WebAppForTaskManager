import { useSyncExternalStore } from 'react';

/**
 * Installing to the home screen. Chrome and Edge fire
 * `beforeinstallprompt`; we keep it so Settings can offer an Install
 * button. Safari has no prompt: there it is Share, then Add to Home Screen.
 */
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPrompt | null = null;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPrompt; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function useInstall(): { canPrompt: boolean; installed: boolean; prompt: () => Promise<void> } {
  const canPrompt = useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => !!deferred);
  return {
    canPrompt,
    installed: isStandalone(),
    async prompt() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      emit();
    },
  };
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const go = () => void navigator.serviceWorker.register('/sw.js').catch(() => {});
  // main.tsx awaits before calling this, so `load` may already have fired.
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
