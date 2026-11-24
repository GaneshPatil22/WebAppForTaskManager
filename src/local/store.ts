import { useSyncExternalStore } from 'react';

/**
 * Device-only state for things the server does not model (the timer,
 * display preferences). localStorage can be blocked or cleared, so
 * every read and write is guarded and the app works with it empty.
 */
export interface LocalStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(l: () => void): () => void;
  use(): T;
  reset(): void;
}

export function createLocalStore<T>(key: string, initial: () => T, storage: Storage | null = safeStorage()): LocalStore<T> {
  let value: T = read() ?? initial();
  const listeners = new Set<() => void>();

  function read(): T | null {
    try {
      const raw = storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  function write() {
    try { storage?.setItem(key, JSON.stringify(value)); } catch { /* keep working in memory */ }
  }
  const store: LocalStore<T> = {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      write();
      for (const l of listeners) l();
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    use() { return useSyncExternalStore(store.subscribe, store.get, store.get); },
    reset() { store.set(initial()); },
  };
  return store;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
