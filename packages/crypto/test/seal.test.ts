import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSealer } from '../src/index.ts';

const SECRET = 'test-only-sealing-secret-0123456789abcdef';
const schema = z.object({ sub: z.string(), email: z.string() });
const payload = { sub: 'user-123', email: 'person@example.test' };

describe('createSealer', () => {
  it('round-trips a payload', async () => {
    const sealer = createSealer(SECRET, 'session');

    const sealed = await sealer.seal(payload, 60);

    expect(await sealer.unseal(sealed, schema)).toEqual(payload);
  });

  it('encrypts: the sealed value does not reveal the payload', async () => {
    const sealed = await createSealer(SECRET, 'session').seal(payload, 60);
    const decodedParts = sealed
      .split('.')
      .map((part) => Buffer.from(part, 'base64url').toString('latin1'))
      .join('');

    expect(decodedParts).not.toContain('person@example.test');
    expect(decodedParts).not.toContain('user-123');
  });

  it('rejects a value that was tampered with', async () => {
    const sealer = createSealer(SECRET, 'session');
    const parts = (await sealer.seal(payload, 60)).split('.');
    const ciphertext = parts[3] ?? '';
    const flipped = `${ciphertext.slice(0, -2)}${ciphertext.endsWith('AA') ? 'AB' : 'AA'}`;
    parts[3] = flipped;

    expect(await sealer.unseal(parts.join('.'), schema)).toBeUndefined();
  });

  it('rejects a value sealed with another secret', async () => {
    const sealed = await createSealer(`${SECRET}-other`, 'session').seal(payload, 60);

    expect(await createSealer(SECRET, 'session').unseal(sealed, schema)).toBeUndefined();
  });

  it('rejects a value sealed for another purpose', async () => {
    const sealed = await createSealer(SECRET, 'auth-transaction').seal(payload, 60);

    expect(await createSealer(SECRET, 'session').unseal(sealed, schema)).toBeUndefined();
  });

  it('rejects an expired value', async () => {
    let clock = new Date('2026-11-09T12:00:00Z');
    const sealer = createSealer(SECRET, 'session', () => clock);
    const sealed = await sealer.seal(payload, 60);

    clock = new Date('2026-11-09T12:00:59Z');
    expect(await sealer.unseal(sealed, schema)).toEqual(payload);
    clock = new Date('2026-11-09T12:01:01Z');
    expect(await sealer.unseal(sealed, schema)).toBeUndefined();
  });

  it('rejects a payload that does not match the schema', async () => {
    const sealer = createSealer(SECRET, 'session');
    const sealed = await sealer.seal({ sub: 42 }, 60);

    expect(await sealer.unseal(sealed, schema)).toBeUndefined();
  });

  it('rejects garbage without throwing', async () => {
    expect(await createSealer(SECRET, 'session').unseal('not-a-jwe', schema)).toBeUndefined();
  });

  it('refuses a short secret', () => {
    expect(() => createSealer('too-short', 'session')).toThrow(/at least 32 characters/);
  });
});
