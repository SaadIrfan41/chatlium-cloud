/**
 * Key-based redaction for log objects.
 *
 * Pino's built-in `redact` option takes exact paths (for example `req.headers.cookie`), so it
 * cannot express "any field whose name contains `key`, at any depth". This sanitizer walks
 * every object passed to the logger and replaces the value of any field whose name matches
 * a sensitive pattern, however deeply it is nested.
 */

export const REDACTED = '[REDACTED]';

/** Field names are matched case-insensitively, as substrings. `apiKey`, `x-api-key` and `KEY` all match. */
const SENSITIVE_NAME = /authorization|cookie|password|passwd|secret|token|key/i;

const MAX_DEPTH = 10;

export function isSensitiveKey(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/** Redacts any value: objects, arrays and errors are walked; primitives are returned unchanged. */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

/** Redacts the fields of an object (or error) and returns a new plain object. */
export function redactRecord(value: object): Record<string, unknown> {
  return walkObject(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item: unknown) => walk(item, depth + 1, seen));
  }
  return walkObject(value, depth, seen);
}

function walkObject(value: object, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  seen.add(value);
  const output: Record<string, unknown> = {};

  if (value instanceof Error) {
    // message and stack are not enumerable, so copy them explicitly.
    output['type'] = value.constructor.name;
    output['message'] = value.message;
    output['stack'] = value.stack;
    if (value.cause !== undefined) {
      output['cause'] = walk(value.cause, depth + 1, seen);
    }
  }

  for (const [name, field] of Object.entries(value)) {
    output[name] = isSensitiveKey(name) ? REDACTED : walk(field, depth + 1, seen);
  }
  return output;
}
