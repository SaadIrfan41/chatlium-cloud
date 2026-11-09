/**
 * Creates (or brings back in line) the development Cognito user pool in Floci (build guide 1.9):
 *   pnpm --filter @chatlium/dev-tools cognito:setup
 *
 * Idempotent. Writes the pool ID, client ID and secret, issuer and test-user credentials to the
 * local .env and prints only non-secret identifiers. Refuses to run against real AWS.
 */
import { randomBytes } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  DescribeUserPoolClientCommand,
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  SetUserPoolMfaConfigCommand,
  UpdateUserPoolClientCommand,
  UserNotFoundException,
  type UserPoolClientType,
} from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';
import { upsertEnv } from './env-file.ts';

const POOL_NAME = 'chatlium-dev';
const CLIENT_NAME = 'chatlium-web';

const env = z
  .object({
    AWS_REGION: z.string().min(1),
    AWS_ENDPOINT_URL: z.url({ error: 'must point at Floci, e.g. http://localhost:4566' }),
    APP_BASE_URL: z.url(),
    DEV_USER_A_PASSWORD: z.string().optional(),
    DEV_USER_B_PASSWORD: z.string().optional(),
  })
  .parse(process.env, { reportInput: false });

const endpoint = new URL(env.AWS_ENDPOINT_URL);
if (!['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
  throw new Error(
    `Refusing to run: AWS_ENDPOINT_URL is not a local Floci endpoint (${endpoint.host})`,
  );
}

const cognito = new CognitoIdentityProviderClient({
  region: env.AWS_REGION,
  endpoint: env.AWS_ENDPOINT_URL,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const callbackUrl = new URL('/api/auth/callback', env.APP_BASE_URL).toString();
const logoutUrl = new URL('/', env.APP_BASE_URL).toString();

/** Meets the pool's policy: length, upper, lower, digit and symbol. */
function generatePassword(): string {
  return `Cl!${randomBytes(18).toString('base64url')}9a`;
}

async function findOrCreatePool(): Promise<string> {
  const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const existing = pools.UserPools?.find((pool) => pool.Name === POOL_NAME)?.Id;
  if (existing !== undefined) {
    return existing;
  }
  const created = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: POOL_NAME,
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 3,
        },
      },
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    }),
  );
  const id = created.UserPool?.Id;
  if (id === undefined) {
    throw new Error('CreateUserPool returned no pool ID');
  }
  return id;
}

/** Client settings from the build guide: code flow with PKCE, server-held secret (ADR 0004). */
const clientSettings = {
  AllowedOAuthFlowsUserPoolClient: true,
  AllowedOAuthFlows: ['code' as const],
  AllowedOAuthScopes: ['openid', 'email', 'profile'],
  SupportedIdentityProviders: ['COGNITO'],
  CallbackURLs: [callbackUrl],
  LogoutURLs: [logoutUrl],
  ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH' as const, 'ALLOW_USER_SRP_AUTH' as const],
  AccessTokenValidity: 15,
  IdTokenValidity: 15,
  RefreshTokenValidity: 7,
  TokenValidityUnits: {
    AccessToken: 'minutes' as const,
    IdToken: 'minutes' as const,
    RefreshToken: 'days' as const,
  },
  PreventUserExistenceErrors: 'ENABLED' as const,
  EnableTokenRevocation: true,
};

async function findOrCreateClient(poolId: string): Promise<UserPoolClientType> {
  const clients = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }),
  );
  const existingId = clients.UserPoolClients?.find((c) => c.ClientName === CLIENT_NAME)?.ClientId;
  if (existingId === undefined) {
    const created = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: poolId,
        ClientName: CLIENT_NAME,
        GenerateSecret: true,
        ...clientSettings,
      }),
    );
    if (created.UserPoolClient === undefined) {
      throw new Error('CreateUserPoolClient returned no client');
    }
    return created.UserPoolClient;
  }
  // Bring an existing client back to the expected settings.
  await cognito.send(
    new UpdateUserPoolClientCommand({
      UserPoolId: poolId,
      ClientId: existingId,
      ClientName: CLIENT_NAME,
      ...clientSettings,
    }),
  );
  const described = await cognito.send(
    new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: existingId }),
  );
  if (described.UserPoolClient === undefined) {
    throw new Error('DescribeUserPoolClient returned no client');
  }
  return described.UserPoolClient;
}

async function ensureUser(poolId: string, email: string, password: string): Promise<void> {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
  } catch (error) {
    if (!(error instanceof UserNotFoundException)) {
      throw error;
    }
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}

const poolId = await findOrCreatePool();
await cognito.send(
  new SetUserPoolMfaConfigCommand({
    UserPoolId: poolId,
    MfaConfiguration: 'OPTIONAL',
    SoftwareTokenMfaConfiguration: { Enabled: true },
  }),
);
const client = await findOrCreateClient(poolId);
if (client.ClientId === undefined || client.ClientSecret === undefined) {
  throw new Error('App client has no ID or secret');
}

const discovery: unknown = await (
  await fetch(new URL(`/${poolId}/.well-known/openid-configuration`, env.AWS_ENDPOINT_URL))
).json();
const { issuer } = z.object({ issuer: z.url() }).parse(discovery);

const users = {
  A: { email: 'operator.a@chatlium.test', password: env.DEV_USER_A_PASSWORD ?? generatePassword() },
  B: { email: 'operator.b@chatlium.test', password: env.DEV_USER_B_PASSWORD ?? generatePassword() },
};
await ensureUser(poolId, users.A.email, users.A.password);
await ensureUser(poolId, users.B.email, users.B.password);

upsertEnv({
  COGNITO_USER_POOL_ID: poolId,
  COGNITO_CLIENT_ID: client.ClientId,
  COGNITO_CLIENT_SECRET: client.ClientSecret,
  COGNITO_ISSUER: issuer,
  DEV_USER_A_EMAIL: users.A.email,
  DEV_USER_A_PASSWORD: users.A.password,
  DEV_USER_B_EMAIL: users.B.email,
  DEV_USER_B_PASSWORD: users.B.password,
});

process.stdout.write(
  [
    `User pool   ${POOL_NAME}  ${poolId}`,
    `App client  ${CLIENT_NAME}  ${client.ClientId}  (secret written to .env)`,
    `Issuer      ${issuer}`,
    `Callback    ${callbackUrl}`,
    `Tokens      access 15 min, ID 15 min, refresh 7 days`,
    `MFA         optional (TOTP)`,
    `Test users  ${users.A.email}, ${users.B.email}  (passwords in .env)`,
    '',
  ].join('\n'),
);
