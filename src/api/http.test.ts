import { describe, expect, it, vi } from 'vitest';
import { HttpBrainClient } from './http';
import { ApiError } from './client';

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(respond: (req: Request) => Response | Promise<Response>, token: string | null = 'tok') {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(new Request(input, init)));
  return { c: new HttpBrainClient('http://brain.test', async () => token, fetchImpl as typeof fetch), fetchImpl };
}

describe('HttpBrainClient', () => {
  it('sends the bearer token', async () => {
    let auth = '';
    const { c } = client((r) => { auth = r.headers.get('Authorization') ?? ''; return json(200, { userId: 'u', timezone: 'Asia/Kolkata' }); });
    await c.getMe();
    expect(auth).toBe('Bearer tok');
  });

  it('201 means created, 200 means it was already stored', async () => {
    const cap = { id: '01JDQ5Z8X3V7K2M9N4P6R8T0W1', text: 'x', source: 'text', status: 'raw', capturedAt: '2026-11-24T00:00:00Z' };
    expect((await client(() => json(201, cap)).c.createCapture({ id: cap.id, text: 'x' })).created).toBe(true);
    expect((await client(() => json(200, cap)).c.createCapture({ id: cap.id, text: 'x' })).created).toBe(false);
  });

  it.each([
    [401, 'unauthorized', false],
    [503, 'unavailable', true],
    [404, 'notFound', false],
    [409, 'conflict', false],
    [400, 'invalid', false],
    [501, 'notImplemented', false],
  ] as const)('%i maps to %s', async (status, kind, retryable) => {
    const { c } = client(() => json(status, { code: `c${status}`, message: 'm' }));
    const err = await c.getPlan().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, kind, code: `c${status}`, retryable });
  });

  it('a network failure is unavailable, not unauthorized', async () => {
    const { c } = client(() => { throw new TypeError('Failed to fetch'); });
    const err = await c.getMe().catch((e) => e);
    expect(err).toMatchObject({ status: 0, kind: 'unavailable' });
  });
});
