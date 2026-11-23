import type { Config } from '../config';
import type { BrainClient } from './client';
import { HttpBrainClient, type TokenSource } from './http';
import { MockBrainClient } from './mock/mockClient';

export function createBrainClient(config: Config, token: TokenSource): BrainClient {
  return config.apiMode === 'mock' ? new MockBrainClient() : new HttpBrainClient(config.apiBaseUrl, token);
}

export { ApiError, isApiError, listAll, type BrainClient } from './client';
export { MockBrainClient } from './mock/mockClient';
