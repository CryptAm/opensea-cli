import { OpenSeaOAuth } from "@opensea/sdk"
import { DEFAULT_AUTH_BASE_URL, resolveOAuthClientId } from "./oauth-config.js"
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  exchangeScopedToken,
  isTrustedSiweOrigin,
  TokenExchangeError,
} from "./siwe-login.js"
import { type StoredToken, saveToken } from "./store.js"

/**
 * The stored refresh token cannot be used again, so only a new login will
 * produce a working token. Carries the sign-in command to run instead of the
 * raw server response.
 */
export class TokenRefreshError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = "TokenRefreshError"
  }
}

export interface RefreshedToken {
  token: StoredToken
  scopeSource: string | undefined
}

// The server's own message, when the body is the usual
// `{"error":{"message":...}}` or OAuth's `{"error_description":...}`, instead
// of the whole JSON body.
function serverMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string }
      error_description?: string
      message?: string
    }
    if (typeof parsed.error === "object" && parsed.error?.message) {
      return parsed.error.message
    }
    if (parsed.error_description) return parsed.error_description
    if (typeof parsed.error === "string") return parsed.error
    if (parsed.message) return parsed.message
  } catch {
    // Not JSON: fall through to the trimmed text.
  }
  return body.trim().slice(0, 200)
}

function siweLoginHint(token: StoredToken): string {
  const scopes = token.requestedScopes.length
    ? token.requestedScopes.join(",")
    : "<scopes>"
  return `opensea auth login --private-key --scopes ${scopes}`
}

async function refreshOAuth(
  token: StoredToken,
  options: { authBaseUrl: string; clientId?: string },
): Promise<RefreshedToken> {
  const oauth = new OpenSeaOAuth({
    clientId: resolveOAuthClientId(options.clientId),
    issuer: options.authBaseUrl,
  })
  let refreshed: Awaited<ReturnType<OpenSeaOAuth["refresh"]>>
  try {
    refreshed = await oauth.refresh(token.refreshToken)
  } catch (error) {
    // The SDK reports a token endpoint rejection as
    // "Token request failed (<status>): <body>".
    const match = /^Token request failed \((\d{3})\): ([\s\S]*)$/.exec(
      (error as Error).message,
    )
    const status = match ? Number(match[1]) : undefined
    if (match && status && [400, 401, 403].includes(status)) {
      throw new TokenRefreshError(
        `The stored refresh token was rejected (${status}: ${serverMessage(match[2])}). Run \`opensea login\` to sign in again.`,
        status,
      )
    }
    throw error
  }
  const next: StoredToken = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt.toISOString(),
    requestedScopes: token.requestedScopes,
    scopes: refreshed.scopes,
    scopeSource: refreshed.scopeSource,
    address: token.address,
    authMethod: "oauth",
  }
  saveToken(next)
  return { token: next, scopeSource: refreshed.scopeSource }
}

async function refreshSiwe(
  token: StoredToken,
  apiBaseUrl: string,
): Promise<RefreshedToken> {
  let data: Awaited<ReturnType<typeof exchangeScopedToken>>
  try {
    data = await exchangeScopedToken(apiBaseUrl, token.refreshToken)
  } catch (error) {
    if (
      error instanceof TokenExchangeError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw new TokenRefreshError(
        `The stored refresh token can no longer be exchanged (${error.status}: ${serverMessage(error.body)}). Run \`${siweLoginHint(token)}\` to sign in again.`,
        error.status,
      )
    }
    throw error
  }
  const expiresAt = new Date(
    Date.now() + (data.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000,
  )
  const scopeSource = data.tokenScopes
    ? "token_exchange"
    : (token.scopeSource ?? "unknown")
  const next: StoredToken = {
    ...token,
    accessToken: data.accessToken,
    expiresAt: expiresAt.toISOString(),
    scopes: data.tokenScopes ?? token.scopes,
    ...(scopeSource === "unknown" ? {} : { scopeSource }),
  }
  saveToken(next)
  return { token: next, scopeSource }
}

/**
 * Refresh a stored wallet auth token and persist the result. OAuth sessions
 * use the refresh-token grant; SIWE sessions exchange the stored scoped token
 * again. Throws {@link TokenRefreshError} when the server rejects the refresh
 * token itself, and rethrows any other failure unchanged.
 */
export async function refreshStoredToken(
  token: StoredToken,
  options: { apiBaseUrl: string; authBaseUrl: string; clientId?: string },
): Promise<RefreshedToken> {
  return token.authMethod === "oauth"
    ? refreshOAuth(token, options)
    : refreshSiwe(token, options.apiBaseUrl)
}

/**
 * Refresh the stored token for a request that needs a new one, print a
 * one-line notice to stderr, and return the new access token.
 */
export async function refreshForRequest(
  token: StoredToken,
  reason: "expired" | "unauthorized",
  options: { apiBaseUrl: string; authBaseUrl: string },
): Promise<string> {
  const { token: next } = await refreshStoredToken(token, options)
  console.error(
    reason === "expired"
      ? `Wallet auth token for ${token.address} expired; refreshed it automatically.`
      : `Wallet auth token for ${token.address} was rejected (401); refreshed it and retrying.`,
  )
  return next.accessToken
}

/**
 * Whether a request may refresh the stored token without being asked. A
 * refresh sends the stored refresh token, which outlives the access token, so
 * it only happens when both the API and the auth server are OpenSea's own:
 * any `--base-url` outside the trusted API origins, or any `--auth-base-url`,
 * turns it off. `opensea auth refresh` still honors those overrides.
 */
export function canRefreshAutomatically(options: {
  apiBaseUrl: string
  authBaseUrl: string
}): boolean {
  return (
    isTrustedSiweOrigin(options.apiBaseUrl) &&
    options.authBaseUrl === DEFAULT_AUTH_BASE_URL
  )
}
