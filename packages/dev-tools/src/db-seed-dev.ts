/**
 * Seeds the local database with two development workspaces for the Floci test users (Step 1.12):
 *   pnpm --filter @chatlium/dev-tools db:seed-dev
 *
 *   Acme Support    operator.a is an operator   2 documents
 *   Beta Help Desk  operator.b is an admin      1 document
 *
 * Idempotent: fixed IDs, ON CONFLICT DO NOTHING. Users are matched on their Cognito `sub`, exactly
 * as the sign-in callback creates them, so a later sign-in lands on the same user row.
 * Uses the admin connection (seeding is not an application path) and refuses non-local hosts.
 */
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { Client } from 'pg';
import { z } from 'zod';

const env = z
  .object({
    DATABASE_ADMIN_URL: z.url(),
    AWS_REGION: z.string().min(1),
    AWS_ENDPOINT_URL: z.url(),
    COGNITO_USER_POOL_ID: z.string().min(1),
    DEV_USER_A_EMAIL: z.string().min(1),
    DEV_USER_B_EMAIL: z.string().min(1),
  })
  .parse(process.env, { reportInput: false });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
for (const [name, value] of [
  ['DATABASE_ADMIN_URL', env.DATABASE_ADMIN_URL],
  ['AWS_ENDPOINT_URL', env.AWS_ENDPOINT_URL],
] as const) {
  if (!LOCAL_HOSTS.has(new URL(value).hostname)) {
    throw new Error(`Refusing to run: ${name} is not a local host`);
  }
}

const DEV_WORKSPACES = {
  acme: { id: '0195d6a4-0000-7000-8000-00000000ac3e', name: 'Acme Support' },
  beta: { id: '0195d6a4-0000-7000-8000-00000000be7a', name: 'Beta Help Desk' },
} as const;

const DOCUMENTS = [
  { id: '0195d6a4-0000-7000-8000-0000000d0c01', workspace: 'acme', title: 'Refund policy' },
  { id: '0195d6a4-0000-7000-8000-0000000d0c02', workspace: 'acme', title: 'Shipping times' },
  { id: '0195d6a4-0000-7000-8000-0000000d0c03', workspace: 'beta', title: 'Account recovery' },
] as const;

const cognito = new CognitoIdentityProviderClient({
  region: env.AWS_REGION,
  endpoint: env.AWS_ENDPOINT_URL,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

async function cognitoSub(email: string): Promise<string> {
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: env.COGNITO_USER_POOL_ID, Username: email }),
  );
  const sub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (sub === undefined) {
    throw new Error(`Cognito user ${email} has no sub; run cognito:setup first`);
  }
  return sub;
}

const client = new Client({ connectionString: env.DATABASE_ADMIN_URL });
await client.connect();
try {
  await client.query('BEGIN');

  async function upsertUser(email: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (cognito_sub, email) VALUES ($1, $2)
       ON CONFLICT (cognito_sub) DO UPDATE SET email = excluded.email
       RETURNING id`,
      [await cognitoSub(email), email],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('user upsert returned no id');
    }
    return id;
  }

  const userA = await upsertUser(env.DEV_USER_A_EMAIL);
  const userB = await upsertUser(env.DEV_USER_B_EMAIL);

  await client.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
    [
      DEV_WORKSPACES.acme.id,
      DEV_WORKSPACES.acme.name,
      DEV_WORKSPACES.beta.id,
      DEV_WORKSPACES.beta.name,
    ],
  );
  await client.query(
    `INSERT INTO memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'operator'), ($3, $4, 'admin')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [DEV_WORKSPACES.acme.id, userA, DEV_WORKSPACES.beta.id, userB],
  );
  await client.query(
    `INSERT INTO documents (id, workspace_id, title, status, s3_key)
     SELECT id, workspace_id, title, 'ready', 'dev/' || id
       FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS seed(id, workspace_id, title)
     ON CONFLICT (id) DO NOTHING`,
    [
      DOCUMENTS.map((document) => document.id),
      DOCUMENTS.map((document) => DEV_WORKSPACES[document.workspace].id),
      DOCUMENTS.map((document) => document.title),
    ],
  );

  await client.query('COMMIT');
  process.stdout.write(
    `Seeded: ${DEV_WORKSPACES.acme.name} (${env.DEV_USER_A_EMAIL}, operator), ` +
      `${DEV_WORKSPACES.beta.name} (${env.DEV_USER_B_EMAIL}, admin), ${String(DOCUMENTS.length)} documents.\n`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
