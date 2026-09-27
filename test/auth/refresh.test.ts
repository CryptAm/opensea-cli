import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { oauthRefresh } = vi.hoisted(() => ({ oauthRefresh: vi.fn() }))

vi.mock("@opensea/sdk", async importOriginal => {
  const actual = await importOriginal<typeof import("@opensea/sdk")>()
  return {
    ...actual,
    OpenSeaOAuth: vi.fn(() => ({ refresh: oauthRefresh })),
  }
})

import {
  canRefreshAutomatically,
  refreshForRequest,
  refreshStoredToken,
  TokenRefreshError,
} from "../../src/auth/refresh.js"
import { loadCurrentToken, type StoredToken } from "../../src/auth/store.js"

const options = {
  apiBaseUrl: "https://api.opensea.io",
  authBaseUrl: "https://auth.opensea.io",
}

const siweToken: StoredToken = {
  accessToken: "old-access",
  refreshToken: "scoped-token",
  scopedTokenId: "token-id",
  sessionCookie: "access_token=a; refresh_token=r",
  expiresAt: "2020-01-01T00:00:00.000Z",
  requestedScopes: ["write:drops", "read:eligibility"],
  scopes: ["write:drops", "read:eligibility"],
  address: "0xabc",
  authMethod: "siwe",
}

const oauthToken: StoredToken = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: "2020-01-01T00:00:00.000Z",
  requestedScopes: ["read:eligibility"],
  scopes: ["read:eligibility"],
  address: "0xabc",
  authMethod: "oauth",
}

function exchangeResponds(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
  )
}

beforeEach(() => {
  oauthRefresh.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("refreshStoredToken", () => {
  it("exchanges a SIWE scoped token and saves the new access token", async () => {
    exchangeResponds(200, { accessToken: "new-access", expiresIn: 3600 })

    const { token } = await refreshStoredToken(siweToken, options)

    expect(token.accessToken).toBe("new-access")
    expect(loadCurrentToken()?.accessToken).toBe("new-access")
  })

  it.each([
    401, 403,
  ])("turns a %i token exchange into a login instruction with the server's message", async status => {
    exchangeResponds(status, {
      error: { message: "Token exchange is not available", code: "x" },
    })

    const error = await refreshStoredToken(siweToken, options).catch(e => e)

    expect(error).toBeInstanceOf(TokenRefreshError)
    expect(error.status).toBe(status)
    expect(error.message).toBe(
      `The stored refresh token can no longer be exchanged (${status}: Token exchange is not available). Run \`opensea auth login --private-key --scopes write:drops,read:eligibility\` to sign in again.`,
    )
    expect(error.message).not.toContain('"code"')
  })

  it("passes other token exchange failures through unchanged", async () => {
    exchangeResponds(500, "upstream down")

    await expect(refreshStoredToken(siweToken, options)).rejects.toThrow(
      "Token exchange failed (500): upstream down",
    )
    await expect(
      refreshStoredToken(siweToken, options),
    ).rejects.not.toBeInstanceOf(TokenRefreshError)
  })

  it("turns a rejected OAuth refresh token into a login instruction", async () => {
    oauthRefresh.mockRejectedValue(
      new Error(
        'Token request failed (400): {"error":"invalid_grant","error_description":"refresh token expired"}',
      ),
    )

    await expect(refreshStoredToken(oauthToken, options)).rejects.toThrow(
      "The stored refresh token was rejected (400: refresh token expired). Run `opensea login` to sign in again.",
    )
  })

  it("passes an OAuth server error through unchanged", async () => {
    oauthRefresh.mockRejectedValue(
      new Error("Token request failed (503): Service Unavailable"),
    )

    await expect(refreshStoredToken(oauthToken, options)).rejects.toThrow(
      "Token request failed (503): Service Unavailable",
    )
  })
})

describe("refreshForRequest", () => {
  it.each([
    ["expired", "expired; refreshed it automatically."],
    ["unauthorized", "was rejected (401); refreshed it and retrying."],
  ] as const)("returns the new token and prints one notice (%s)", async (reason, notice) => {
    exchangeResponds(200, { accessToken: "new-access" })
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(refreshForRequest(siweToken, reason, options)).resolves.toBe(
      "new-access",
    )

    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      `Wallet auth token for 0xabc ${notice}`,
    )
  })
})

describe("canRefreshAutomatically", () => {
  it.each([
    [options, true],
    [{ ...options, apiBaseUrl: "https://testnets-api.opensea.io" }, true],
    [{ ...options, apiBaseUrl: "http://localhost:8080" }, false],
    [{ ...options, authBaseUrl: "https://auth.example.com" }, false],
  ])("%j -> %s", (targets, expected) => {
    expect(canRefreshAutomatically(targets)).toBe(expected)
  })
})
