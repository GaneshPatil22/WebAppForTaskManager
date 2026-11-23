/**
 * Build-time configuration. Like the server, the app refuses to start in a
 * half-configured state: http mode without Supabase values is an error
 * screen, never a silent fallback to mock.
 */
export type ApiMode = 'mock' | 'http';

export interface Config {
  apiMode: ApiMode;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
}

export function readConfig(env: ImportMetaEnv = import.meta.env): { config: Config } | { error: string } {
  const mode = (env.VITE_API_MODE ?? 'mock').trim() || 'mock';
  if (mode !== 'mock' && mode !== 'http') {
    return { error: `VITE_API_MODE must be "mock" or "http", not "${mode}".` };
  }
  const config: Config = {
    apiMode: mode,
    apiBaseUrl: (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, ''),
    supabaseUrl: (env.VITE_SUPABASE_URL ?? '').trim(),
    supabaseKey: (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
  };
  if (mode === 'http' && (!config.supabaseUrl || !config.supabaseKey)) {
    return { error: 'http mode needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. See .env.example.' };
  }
  return { config };
}
