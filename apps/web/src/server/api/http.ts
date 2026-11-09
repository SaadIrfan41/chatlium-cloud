// Shared response handling for the framework-free API handlers. No `server-only`, no `@/` alias.
import { ForbiddenError, UnauthenticatedError } from '@chatlium/auth';

/** Tenant data must never be cached by browsers or shared caches. */
const NO_STORE = { 'cache-control': 'no-store' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** A request the API refuses with a specific status and a stable, non-sensitive error code. */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problems: readonly string[] | undefined;

  constructor(status: number, code: string, problems?: readonly string[]) {
    super(code);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
}

/**
 * Maps failures to responses. Every ForbiddenError gets the same 403 body, so a caller cannot
 * tell "no such workspace" from "not a member", "role too low" or "failed the CSRF check".
 */
export async function handled(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return json({ error: 'unauthenticated' }, 401);
    }
    if (error instanceof ForbiddenError) {
      return json({ error: 'forbidden' }, 403);
    }
    if (error instanceof RequestError) {
      return json(
        error.problems === undefined
          ? { error: error.code }
          : { error: error.code, problems: error.problems },
        error.status,
      );
    }
    throw error;
  }
}

/**
 * Reads a JSON body of at most `maxBytes`. An oversized body is refused before it is parsed
 * (amendments: payload size limit), whether or not the client declared its length.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    throw new RequestError(415, 'unsupported_media_type');
  }
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (declared > maxBytes) {
    throw new RequestError(413, 'payload_too_large');
  }
  if (request.body === null) {
    throw new RequestError(400, 'invalid_json');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- a stream is read chunk by chunk
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      break;
    }
    chunks.push(value);
  }
  if (total > maxBytes) {
    await reader.cancel();
    throw new RequestError(413, 'payload_too_large');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new RequestError(400, 'invalid_json');
  }
}
