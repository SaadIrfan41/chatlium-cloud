import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/index.ts';

const completeEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://chatlium_app:app-password@localhost:5432/chatlium',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  COGNITO_USER_POOL_ID: 'us-east-1_abc123',
  COGNITO_CLIENT_ID: 'client-id-123',
  COGNITO_CLIENT_SECRET: 'test-client-secret',
  COGNITO_ISSUER: 'http://localhost:4566/us-east-1_abc123',
  SESSION_SEALING_KEY: 'test-only-sealing-key-0123456789abcdef',
  GEMINI_API_KEY_SECRET_ID: 'chatlium/dev/gemini-api-key',
} satisfies NodeJS.ProcessEnv;

function captureError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('loadConfig', () => {
  it('parses a complete environment', () => {
    const config = loadConfig(completeEnv);

    expect(config.NODE_ENV).toBe('test');
    expect(config.AWS_REGION).toBe('us-east-1');
    expect(config.COGNITO_ISSUER).toBe('http://localhost:4566/us-east-1_abc123');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('fails with a message naming a missing required variable', () => {
    const { COGNITO_CLIENT_ID: _omitted, ...env } = completeEnv;

    const error = captureError(env);

    expect(error.problems).toEqual([{ variable: 'COGNITO_CLIENT_ID', problem: 'is required' }]);
    expect(error.message).toContain('COGNITO_CLIENT_ID: is required');
  });

  it('reports a missing URL variable as required, not as a malformed URL', () => {
    const { APP_BASE_URL: _omitted, ...env } = completeEnv;

    const error = captureError(env);

    expect(error.problems).toEqual([{ variable: 'APP_BASE_URL', problem: 'is required' }]);
  });

  it('fails on a malformed value', () => {
    const error = captureError({ ...completeEnv, DATABASE_URL: 'mysql://localhost/chatlium' });

    expect(error.problems).toEqual([
      {
        variable: 'DATABASE_URL',
        problem: 'must be a URL with protocol postgres:// or postgresql://',
      },
    ]);
  });

  it('lists every problem at once and treats empty strings as missing', () => {
    const error = captureError({ ...completeEnv, AWS_REGION: 'nowhere', REDIS_URL: '' });

    expect(error.problems.map((p) => p.variable).toSorted()).toEqual(['AWS_REGION', 'REDIS_URL']);
  });

  it('never includes a secret value in the error', () => {
    const shortSecret = 'leak-me-0123';
    const badDatabaseUrl = 'mysql://user:super-secret-password@db/chatlium';

    const error = captureError({
      ...completeEnv,
      SESSION_SEALING_KEY: shortSecret,
      DATABASE_URL: badDatabaseUrl,
    });

    const serialized = `${error.message}\n${JSON.stringify(error.problems)}\n${String(error.stack)}`;
    expect(serialized).toContain('SESSION_SEALING_KEY: must be at least 32 characters');
    expect(serialized).not.toContain(shortSecret);
    expect(serialized).not.toContain('super-secret-password');
  });

  it('applies defaults for optional settings', () => {
    const { NODE_ENV: _n, LOG_LEVEL: _l, AWS_ENDPOINT_URL: _e, ...env } = completeEnv;

    const config = loadConfig(env);

    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.AWS_ENDPOINT_URL).toBeUndefined();
  });
});
