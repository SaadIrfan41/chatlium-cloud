import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdTokenVerifier } from '../src/index.ts';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test123';
const CLIENT_ID = 'test-client-id';
const KID = 'test-key-1';

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let verify: ReturnType<typeof createIdTokenVerifier>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwks: JSONWebKeySet = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }],
  };
  verify = createIdTokenVerifier({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    keys: createLocalJWKSet(jwks),
  });
});

interface TokenOverrides {
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  tokenUse?: string;
  key?: CryptoKey;
  email?: string | null;
}

async function idToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { token_use: overrides.tokenUse ?? 'id' };
  if (overrides.email !== null) {
    claims['email'] = overrides.email ?? 'operator.a@chatlium.test';
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject('0195d6a4-0000-7000-8000-0000000000aa')
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? CLIENT_ID)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (overrides.expiresInSeconds ?? 900))
    .sign(overrides.key ?? signingKey);
}

describe('verifyIdToken', () => {
  it('accepts a valid ID token and returns its claims', async () => {
    const claims = await verify(await idToken());

    expect(claims).toMatchObject({
      sub: '0195d6a4-0000-7000-8000-0000000000aa',
      email: 'operator.a@chatlium.test',
    });
  });

  it('rejects an expired token', async () => {
    await expect(verify(await idToken({ expiresInSeconds: -60 }))).rejects.toThrow(
      /Invalid ID token: ERR_JWT_EXPIRED/,
    );
  });

  it('rejects a token for another audience (app client)', async () => {
    await expect(verify(await idToken({ audience: 'another-client' }))).rejects.toThrow(
      /Invalid ID token: ERR_JWT_CLAIM_VALIDATION_FAILED/,
    );
  });

  it('rejects a token from another issuer (user pool)', async () => {
    await expect(
      verify(
        await idToken({ issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other' }),
      ),
    ).rejects.toThrow(/Invalid ID token: ERR_JWT_CLAIM_VALIDATION_FAILED/);
  });

  it('rejects an access token presented as an ID token (token_use)', async () => {
    await expect(verify(await idToken({ tokenUse: 'access' }))).rejects.toThrow(
      /Invalid ID token: not an ID token/,
    );
  });

  it('rejects a token signed with a key that is not in the JWKS', async () => {
    await expect(verify(await idToken({ key: otherKey }))).rejects.toThrow(
      /Invalid ID token: ERR_JWS_SIGNATURE_VERIFICATION_FAILED/,
    );
  });

  it('rejects an unsigned token (alg none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url');
    const valid = (await idToken()).split('.');
    const unsigned = `${header}.${valid[1] ?? ''}.`;

    await expect(verify(unsigned)).rejects.toThrow(/Invalid ID token: /);
  });

  it('rejects an HS256 token (algorithm confusion with a shared secret)', async () => {
    const secret = new TextEncoder().encode('attacker-chosen-shared-secret-0123456789');
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({ token_use: 'id', email: 'attacker@example.test' })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setSubject('someone')
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(secret);

    await expect(verify(forged)).rejects.toThrow(/Invalid ID token: /);
  });

  it('rejects a token without an email claim', async () => {
    await expect(verify(await idToken({ email: null }))).rejects.toThrow(
      /Invalid ID token: not an ID token, or missing sub or email/,
    );
  });
});
