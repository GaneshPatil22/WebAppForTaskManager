import { useEffect } from 'react';
import { createLocalStore } from '../local/store';

export type ThemePref = 'system' | 'light' | 'dark';
export const themeStore = createLocalStore<ThemePref>('brain-theme-pref', () => 'system');

export function applyTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === 'system') localStorage.removeItem('brain-theme'); else localStorage.setItem('brain-theme', t);
  } catch { /* fine */ }
}

export function useApplyTheme() {
  const t = themeStore.use();
  useEffect(() => applyTheme(t), [t]);
}

export function effectiveDark(t: ThemePref): boolean {
  return t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}
