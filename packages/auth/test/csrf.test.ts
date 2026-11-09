import { describe, expect, it } from 'vitest';
import { CSRF_HEADER, ForbiddenError, verifyStateChangingRequest } from '../src/index.ts';

const expected = { origin: 'http://localhost:3000', csrfToken: 'csrf-token-0123456789abcdef' };

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/x', { method: 'POST', headers });
}

describe('verifyStateChangingRequest', () => {
  it('accepts the app origin with the session token', () => {
    expect(() =>
      verifyStateChangingRequest(
        request({ origin: expected.origin, [CSRF_HEADER]: expected.csrfToken }),
        expected,
      ),
    ).not.toThrow();
  });

  it.each([
    ['no Origin', { [CSRF_HEADER]: expected.csrfToken }],
    ['another Origin', { origin: 'https://evil.example', [CSRF_HEADER]: expected.csrfToken }],
    ['no token', { origin: expected.origin }],
    ['a wrong token', { origin: expected.origin, [CSRF_HEADER]: 'csrf-token-0123456789abcdeX' }],
    ['a token of another length', { origin: expected.origin, [CSRF_HEADER]: 'short' }],
  ])('refuses a request with %s', (_case, headers) => {
    expect(() => verifyStateChangingRequest(request(headers), expected)).toThrow(ForbiddenError);
  });
});
