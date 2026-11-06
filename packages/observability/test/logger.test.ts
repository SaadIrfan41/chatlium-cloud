import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED, withContext, type Logger } from '../src/index.ts';

const FAKE_SECRET = 'sk-test-fake-secret-1f2e3d4c';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(chunk: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(chunk);
  if (!isRecord(parsed)) {
    throw new Error(`log line is not a JSON object: ${chunk}`);
  }
  return parsed;
}

function capture(): { logger: Logger; lines: () => Record<string, unknown>[]; raw: () => string } {
  const chunks: string[] = [];
  const logger = createLogger({
    service: 'test-service',
    level: 'debug',
    destination: { write: (chunk: string) => void chunks.push(chunk) },
  });
  return {
    logger,
    raw: () => chunks.join(''),
    lines: () => chunks.map(parseLine),
  };
}

describe('createLogger', () => {
  it('writes JSON lines with an ISO timestamp, a level label and the service name', () => {
    const { logger, lines } = capture();

    logger.info('started');

    const [line] = lines();
    expect(line).toMatchObject({ level: 'info', service: 'test-service', msg: 'started' });
    expect(line?.['time']).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    );
  });

  it('never writes a fake secret, whatever sensitive field it is in', () => {
    const { logger, raw, lines } = capture();

    logger.info(
      {
        authorization: `Bearer ${FAKE_SECRET}`,
        password: FAKE_SECRET,
        token: FAKE_SECRET,
        apiKey: FAKE_SECRET,
        'x-api-key': FAKE_SECRET,
        req: { headers: { cookie: `session=${FAKE_SECRET}`, Authorization: FAKE_SECRET } },
        deep: { a: { b: { c: { refreshToken: FAKE_SECRET } } } },
        list: [{ secretKey: FAKE_SECRET }],
      },
      'request received',
    );

    expect(raw()).not.toContain(FAKE_SECRET);
    const [line] = lines();
    expect(line).toMatchObject({
      authorization: REDACTED,
      password: REDACTED,
      token: REDACTED,
      apiKey: REDACTED,
      'x-api-key': REDACTED,
      req: { headers: { cookie: REDACTED, Authorization: REDACTED } },
      deep: { a: { b: { c: { refreshToken: REDACTED } } } },
      list: [{ secretKey: REDACTED }],
    });
  });

  it('keeps fields that are not sensitive', () => {
    const { logger, lines } = capture();

    logger.info({ document_id: 'doc-1', chunks: 12, status: 'ready' }, 'indexed');

    expect(lines()[0]).toMatchObject({ document_id: 'doc-1', chunks: 12, status: 'ready' });
  });

  it('serializes errors with their message and stack, and redacts secrets on them', () => {
    const { logger, raw, lines } = capture();
    const error = Object.assign(new Error('provider timed out'), {
      token: FAKE_SECRET,
      attempt: 2,
    });

    logger.error({ err: error }, 'llm call failed');

    expect(raw()).not.toContain(FAKE_SECRET);
    const err = lines()[0]?.['err'];
    if (!isRecord(err)) {
      throw new Error('expected err to be an object');
    }
    expect(err).toMatchObject({
      type: 'Error',
      message: 'provider timed out',
      token: REDACTED,
      attempt: 2,
    });
    expect(err['stack']).toEqual(expect.stringContaining('provider timed out'));
  });

  it('handles circular references without crashing', () => {
    const { logger, lines } = capture();
    const node: Record<string, unknown> = { name: 'loop' };
    node['self'] = node;

    logger.info({ node }, 'circular');

    expect(lines()[0]).toMatchObject({ node: { name: 'loop', self: '[Circular]' } });
  });
});

describe('withContext', () => {
  it('adds workspace_id and request_id to every line of the child logger', () => {
    const { logger, lines } = capture();

    const child = withContext(logger, { workspaceId: 'ws-123', requestId: 'req-456' });
    child.info('one');
    child.warn('two');

    for (const line of lines()) {
      expect(line).toMatchObject({
        service: 'test-service',
        workspace_id: 'ws-123',
        request_id: 'req-456',
      });
    }
    expect(lines()).toHaveLength(2);
  });

  it('adds only the context fields that are set', () => {
    const { logger, lines } = capture();

    withContext(logger, { requestId: 'req-only' }).info('partial');

    expect(lines()[0]).toMatchObject({ request_id: 'req-only' });
    expect(lines()[0]).not.toHaveProperty('workspace_id');
  });

  it('redacts secrets passed as child bindings', () => {
    const { logger, raw } = capture();

    logger.child({ sessionToken: FAKE_SECRET }).info('bound');

    expect(raw()).not.toContain(FAKE_SECRET);
  });
});
