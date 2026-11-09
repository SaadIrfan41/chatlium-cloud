import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, upsertUserByCognitoSub, type Database } from '../../src/index.ts';
import { startMigratedDatabase, type MigratedDatabase } from './fixture.ts';

let fixture: MigratedDatabase;
let app: Database;

beforeAll(async () => {
  fixture = await startMigratedDatabase();
  app = createDatabase(fixture.appUrl);
});

afterAll(async () => {
  await app.close();
  await fixture.stop();
});

describe('upsertUserByCognitoSub', () => {
  it('creates the user on first sign-in, as the application role', async () => {
    const id = await upsertUserByCognitoSub(app.db, {
      cognitoSub: 'sub-first',
      email: 'first@chatlium.test',
    });

    const row = await fixture.admin.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE cognito_sub = 'sub-first'",
    );
    expect(row.rows).toEqual([{ id, email: 'first@chatlium.test' }]);
  });

  it('returns the same ID on later sign-ins and refreshes the email', async () => {
    const first = await upsertUserByCognitoSub(app.db, {
      cognitoSub: 'sub-again',
      email: 'old@chatlium.test',
    });
    const second = await upsertUserByCognitoSub(app.db, {
      cognitoSub: 'sub-again',
      email: 'new@chatlium.test',
    });

    expect(second).toBe(first);
    const row = await fixture.admin.query<{ email: string; n: string }>(
      "SELECT max(email) AS email, count(*) AS n FROM users WHERE cognito_sub = 'sub-again'",
    );
    expect(row.rows).toEqual([{ email: 'new@chatlium.test', n: '1' }]);
  });

  it('gives different Cognito identities different user IDs', async () => {
    const a = await upsertUserByCognitoSub(app.db, {
      cognitoSub: 'sub-x',
      email: 'x@chatlium.test',
    });
    const b = await upsertUserByCognitoSub(app.db, {
      cognitoSub: 'sub-y',
      email: 'y@chatlium.test',
    });

    expect(a).not.toBe(b);
  });
});
