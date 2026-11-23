import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

describe('readConfig refuses a half-configured app', () => {
  it('defaults to mock', () => {
    expect(readConfig({} as ImportMetaEnv)).toEqual({ config: { apiMode: 'mock', apiBaseUrl: '', supabaseUrl: '', supabaseKey: '' } });
  });
  it('http without Supabase is an error, never a fallback to mock', () => {
    expect(readConfig({ VITE_API_MODE: 'http' } as ImportMetaEnv)).toHaveProperty('error');
  });
  it('rejects an unknown mode and trims a trailing slash', () => {
    expect(readConfig({ VITE_API_MODE: 'live' } as ImportMetaEnv)).toHaveProperty('error');
    const r = readConfig({ VITE_API_MODE: 'http', VITE_API_BASE_URL: 'https://api.x/', VITE_SUPABASE_URL: 'https://p.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' } as ImportMetaEnv);
    expect('config' in r && r.config.apiBaseUrl).toBe('https://api.x');
  });
});
