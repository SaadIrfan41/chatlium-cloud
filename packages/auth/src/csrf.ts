import { timingSafeEqual } from 'node:crypto';
import { ForbiddenError } from './workspace-role.ts';

/** The header the dashboard sends the session's CSRF token in, for JSON API calls. */
export const CSRF_HEADER = 'x-csrf-token';

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Amendments §2: a state-changing request needs a trusted `Origin` and the session's CSRF
 * synchronizer token. SameSite=Lax cookies alone are not relied on. Throws ForbiddenError, which
 * routes answer with the same 403 as any other authorization failure.
 */
export function verifyStateChangingRequest(
  request: Request,
  expected: { readonly origin: string; readonly csrfToken: string },
): void {
  if (request.headers.get('origin') !== expected.origin) {
    throw new ForbiddenError();
  }
  const token = request.headers.get(CSRF_HEADER);
  if (token === null || !sameToken(token, expected.csrfToken)) {
    throw new ForbiddenError();
  }
}
