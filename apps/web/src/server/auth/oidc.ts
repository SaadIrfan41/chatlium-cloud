import 'server-only';
import * as oidc from 'openid-client';
import { config } from '../config.ts';

let discovered: Promise<oidc.Configuration> | undefined;

/**
 * True only for the local Floci issuer (http://localhost). Production issuers are always HTTPS,
 * and openid-client refuses plain HTTP unless this is allowed explicitly.
 */
function isLocalHttpIssuer(issuer: URL): boolean {
  return (
    issuer.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(issuer.hostname) &&
    config().NODE_ENV !== 'production'
  );
}

/** The Cognito OIDC configuration, from the issuer's discovery document. Cached per process. */
export function oidcConfig(): Promise<oidc.Configuration> {
  if (discovered === undefined) {
    const issuer = new URL(config().COGNITO_ISSUER);
    discovered = oidc
      .discovery(
        issuer,
        config().COGNITO_CLIENT_ID,
        undefined,
        oidc.ClientSecretBasic(config().COGNITO_CLIENT_SECRET),
        isLocalHttpIssuer(issuer) ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered = undefined; // retry discovery on the next request
        throw error;
      });
  }
  return discovered;
}

/** Built from configuration, never from the request's Host header. */
export function callbackUrl(): URL {
  return new URL('/api/auth/callback', config().APP_BASE_URL);
}

/**
 * Cognito's sign-out endpoint is not in its discovery document. It sits next to the authorize
 * endpoint: `<domain>/oauth2/authorize` → `<domain>/logout` (AWS) and
 * `/cognito-idp/oauth2/authorize` → `/cognito-idp/logout` (Floci).
 */
export async function logoutUrl(): Promise<URL> {
  const authorize = (await oidcConfig()).serverMetadata().authorization_endpoint;
  if (authorize === undefined) {
    throw new Error('issuer metadata has no authorization_endpoint');
  }
  const url = new URL(authorize.replace(/\/oauth2\/authorize$/, '/logout'));
  url.searchParams.set('client_id', config().COGNITO_CLIENT_ID);
  url.searchParams.set('logout_uri', new URL('/', config().APP_BASE_URL).toString());
  return url;
}
