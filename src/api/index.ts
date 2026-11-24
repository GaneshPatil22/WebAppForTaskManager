import type { Config } from '../config';
import type { BrainClient } from './client';
import { HttpBrainClient, type TokenSource } from './http';
import type { MockBrainClient } from './mock/mockClient';

/**
 * The real server, or the in-browser mock. The mock is loaded only in mock
 * mode, so a production build never downloads it.
 */
export async function createBrainClient(config: Config, token: TokenSource): Promise<{ client: BrainClient; mock: MockBrainClient | null }> {
  if (config.apiMode === 'mock') {
    const { MockBrainClient } = await import('./mock/mockClient');
    const mock = new MockBrainClient();
    return { client: mock, mock };
  }
  return { client: new HttpBrainClient(config.apiBaseUrl, token), mock: null };
}

export { ApiError, isApiError, listAll, type BrainClient } from './client';
export type { MockBrainClient } from './mock/mockClient';
