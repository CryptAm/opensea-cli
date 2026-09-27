import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type StoredToken, saveToken } from "../src/auth/store.js"
import { createProgram } from "../src/program.js"

// Parses real argv through the full program so the wiring in getClient is
// what is under test: which tokens are refreshable, and the opt-out flag.

const expiredSiwe: StoredToken = {
  accessToken: "old-access",
  refreshToken: "scoped-token",
  scopedTokenId: "token-id",
  sessionCookie: "access_token=a; refresh_token=r",
  expiresAt: "2020-01-01T00:00:00.000Z",
  requestedScopes: ["read:eligibility"],
  scopes: ["read:eligibility"],
  address: "0xabc",
  authMethod: "siwe",
}

let fetchSpy: ReturnType<typeof vi.fn>

function authorization(call: number): string | undefined {
  const init = fetchSpy.mock.calls[call][1] as RequestInit
  return (init.headers as Record<string, string>).Authorization
}

beforeEach(() => {
  vi.stubEnv("OPENSEA_API_KEY", "test-key")
  saveToken(expiredSiwe)
  fetchSpy = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/api/v2/auth/tokens/exchange")) {
      return new Response(JSON.stringify({ accessToken: "new-access" }))
    }
    return new Response(JSON.stringify({ eligible: true }))
  })
  vi.stubGlobal("fetch", fetchSpy)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function run(...argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv, { from: "user" })
}

describe("automatic wallet auth token refresh", () => {
  it("refreshes an expired stored token before the request and says so", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {})

    await run("drops", "eligibility", "cool-cats")

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://api.opensea.io/api/v2/auth/tokens/exchange",
    )
    expect(authorization(1)).toBe("Bearer new-access")
    expect(stderr).toHaveBeenCalledWith(
      "Wallet auth token for 0xabc expired; refreshed it automatically.",
    )
  })

  it("--no-auth-refresh sends the stored token as is", async () => {
    await run("--no-auth-refresh", "drops", "eligibility", "cool-cats")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(authorization(0)).toBe("Bearer old-access")
  })

  it("never sends the refresh token to a --base-url override", async () => {
    await run(
      "--base-url",
      "https://proxy.example.com",
      "drops",
      "eligibility",
      "cool-cats",
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://proxy.example.com/api/v2/drops/cool-cats/eligibility",
    )
    expect(authorization(0)).toBe("Bearer old-access")
  })

  it("does not refresh automatically with an --auth-base-url override", async () => {
    await run(
      "--auth-base-url",
      "https://auth.example.com",
      "drops",
      "eligibility",
      "cool-cats",
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(authorization(0)).toBe("Bearer old-access")
  })

  it("never refreshes a token passed with --auth-token", async () => {
    await run("--auth-token", "explicit", "drops", "eligibility", "cool-cats")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(authorization(0)).toBe("Bearer explicit")
  })
})
