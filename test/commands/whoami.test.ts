import { afterEach, describe, expect, it, vi } from "vitest"

const { loadCurrentToken } = vi.hoisted(() => ({
  loadCurrentToken: vi.fn(),
}))

vi.mock("../../src/auth/store.js", () => ({ loadCurrentToken }))

import { whoamiCommand } from "../../src/commands/whoami.js"
import type { OutputFormat } from "../../src/output.js"
import { createCommandTestContext } from "../mocks.js"

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `header.${encoded}.signature`
}

describe("whoamiCommand", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("reports when no token is stored", async () => {
    loadCurrentToken.mockReturnValue(undefined)
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync([], { from: "user" })

    expect(ctx.consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(
        { status: "not_authenticated", message: "No stored token" },
        null,
        2,
      ),
    )
  })

  it("reports expired tokens", async () => {
    loadCurrentToken.mockReturnValue({
      accessToken: jwt({ wallet: "0xabc" }),
      refreshToken: "refresh-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
      requestedScopes: [],
      scopes: [],
      address: "0xabc",
      authMethod: "oauth",
    })
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync([], { from: "user" })

    const output = JSON.parse(ctx.consoleSpy.mock.calls[0][0] as string) as {
      status: string
      expired: boolean
    }
    expect(output.status).toBe("expired")
    expect(output.expired).toBe(true)
  })

  it("reports malformed JWTs only in diagnostic output", async () => {
    loadCurrentToken.mockReturnValue({
      accessToken: "opaque-token",
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      requestedScopes: [],
      scopes: [],
      address: "0xabc",
      authMethod: "oauth",
    })
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync(["--diagnostic"], {
      from: "user",
    })

    const output = JSON.parse(ctx.consoleSpy.mock.calls[0][0] as string) as {
      diagnostic: { jwt_error: string }
    }
    expect(output.diagnostic.jwt_error).toBe(
      "Access token is not a readable JWT",
    )
    expect(ctx.consoleSpy.mock.calls[0][0]).not.toContain("opaque-token")
  })

  it("keeps default output provider-neutral", async () => {
    loadCurrentToken.mockReturnValue({
      accessToken: jwt({
        wallet: "0xabc",
        opensea_scopes: ["read:eligibility", "write:drops"],
        "urn:zitadel:iam:org:project:roles": {
          agents: ["member"],
        },
      }),
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      requestedScopes: ["read:eligibility"],
      scopes: ["read:eligibility"],
      address: "0xabc",
      authMethod: "oauth",
    })
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync([], { from: "user" })

    const output = JSON.parse(ctx.consoleSpy.mock.calls[0][0] as string) as {
      scopes: string[]
      scope_source: string
      diagnostic?: unknown
    }
    expect(output.scopes).toEqual(["read:eligibility"])
    expect(output.scope_source).toBe("unknown")
    expect(output.diagnostic).toBeUndefined()
    expect(ctx.consoleSpy.mock.calls[0][0]).not.toContain("zitadel")
  })

  it("reports requested and broader granted OAuth scopes", async () => {
    loadCurrentToken.mockReturnValue({
      accessToken: jwt({
        wallet: "0xabc",
        opensea_scopes: ["read:favorites", "write:favorites", "write:wallets"],
      }),
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      requestedScopes: ["read:favorites", "write:favorites"],
      scopes: ["read:favorites", "write:favorites", "write:wallets"],
      address: "0xabc",
      authMethod: "oauth",
    })
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync([], { from: "user" })

    const output = JSON.parse(ctx.consoleSpy.mock.calls[0][0] as string) as {
      requested_scopes: string[]
      granted_scopes: string[]
      scope_warning: { type: string; scopes: string[] }
    }
    expect(output.requested_scopes).toEqual([
      "read:favorites",
      "write:favorites",
    ])
    expect(output.granted_scopes).toEqual([
      "read:favorites",
      "write:favorites",
      "write:wallets",
    ])
    expect(output.scope_warning).toEqual({
      type: "broader_than_requested",
      scopes: ["write:wallets"],
    })
  })

  it("shows unverified JWT diagnostics only when requested", async () => {
    loadCurrentToken.mockReturnValue({
      accessToken: jwt({
        wallet: "0xabc",
        opensea_scopes: ["read:eligibility", "write:drops"],
        "urn:zitadel:iam:org:project:roles": {
          agents: ["member"],
        },
      }),
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      requestedScopes: ["read:eligibility"],
      scopes: ["read:eligibility"],
      scopeSource: "token_exchange",
      address: "0xabc",
      authMethod: "siwe",
      scopedTokenId: "pat-id",
      sessionCookie: "access_token=session; refresh_token=refresh",
    })
    const ctx = createCommandTestContext()

    await whoamiCommand(ctx.getFormat).parseAsync(["--diagnostic"], {
      from: "user",
    })

    const output = JSON.parse(ctx.consoleSpy.mock.calls[0][0] as string) as {
      scope_source: string
      diagnostic: {
        unverified: boolean
        jwt: {
          project_roles: Record<string, string[]>
        }
        scope_difference: {
          only_in_jwt: string[]
        }
      }
    }
    expect(output.scope_source).toBe("token_exchange")
    expect(output.diagnostic.unverified).toBe(true)
    expect(output.diagnostic.jwt.project_roles).toEqual({
      agents: ["member"],
    })
    expect(output.diagnostic.scope_difference.only_in_jwt).toEqual([
      "write:drops",
    ])
  })
})

const EVM_PRIMARY = "0x1111111111111111111111111111111111111111"
const EVM_SECOND = "0x2222222222222222222222222222222222222222"
const SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"

const CLAIM_ABSENT_MESSAGE =
  "This access token carries no linked_wallets claim, so the number of wallets it covers is unknown."
const CLAIM_UNREADABLE_MESSAGE =
  "The linked_wallets claim is present but is not a list, so the number of wallets it covers is unknown."
const TOKEN_UNREADABLE_MESSAGE =
  "The stored access token is not a readable JWT, so the number of wallets it covers is unknown."
const EMPTY_MESSAGE =
  "The linked_wallets claim is present and lists no usable wallet addresses."

function storedToken(accessToken: string, address = EVM_PRIMARY) {
  return {
    accessToken,
    refreshToken: "refresh-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
    requestedScopes: [],
    scopes: [],
    address,
    authMethod: "oauth",
  }
}

async function runWhoami(
  accessToken: string,
  argv: string[] = [],
  format: OutputFormat = "json",
): Promise<string> {
  loadCurrentToken.mockReturnValue(storedToken(accessToken))
  const ctx = createCommandTestContext()
  await whoamiCommand(() => format).parseAsync(argv, { from: "user" })
  return ctx.consoleSpy.mock.calls[0][0] as string
}

function linkedWalletsOf(output: string): unknown {
  return (JSON.parse(output) as { linked_wallets: unknown }).linked_wallets
}

describe("whoamiCommand linked wallets", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("lists every linked wallet and marks the token's own", async () => {
    const output = await runWhoami(
      jwt({
        wallet: EVM_PRIMARY,
        linked_wallets: [EVM_PRIMARY, EVM_SECOND, SOLANA],
      }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "listed",
      count: 3,
      wallets: [
        { address: EVM_PRIMARY, primary: true },
        { address: EVM_SECOND, primary: false },
        { address: SOLANA, primary: false },
      ],
    })
  })

  it("places linked_wallets next to address in the JSON output", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: [EVM_PRIMARY, EVM_SECOND] }),
    )

    expect(output).toBe(
      JSON.stringify(
        {
          status: "authenticated",
          address: EVM_PRIMARY,
          linked_wallets: {
            status: "listed",
            count: 2,
            wallets: [
              { address: EVM_PRIMARY, primary: true },
              { address: EVM_SECOND, primary: false },
            ],
          },
          auth_method: "oauth",
          scopes: [],
          requested_scopes: [],
          granted_scopes: [],
          scope_source: "unknown",
          expires_at: "2030-01-01T00:00:00.000Z",
          expired: false,
        },
        null,
        2,
      ),
    )
  })

  it("does not double count the primary already in the claim", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: [EVM_PRIMARY] }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "listed",
      count: 1,
      wallets: [{ address: EVM_PRIMARY, primary: true }],
    })
  })

  it("matches the primary across EVM checksum casing", async () => {
    const checksummed = "0xAbC0000000000000000000000000000000000001"
    const output = await runWhoami(
      jwt({
        wallet: checksummed,
        linked_wallets: [checksummed.toLowerCase(), EVM_SECOND],
      }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "listed",
      count: 2,
      wallets: [
        { address: checksummed.toLowerCase(), primary: true },
        { address: EVM_SECOND, primary: false },
      ],
    })
  })

  it("does not fold case when matching a Solana address", async () => {
    const output = await runWhoami(
      jwt({ wallet: SOLANA, linked_wallets: [SOLANA.toLowerCase(), SOLANA] }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "listed",
      count: 2,
      wallets: [
        { address: SOLANA.toLowerCase(), primary: false },
        { address: SOLANA, primary: true },
      ],
    })
  })

  it("marks nothing primary when the wallet claim is absent", async () => {
    const output = await runWhoami(
      jwt({ linked_wallets: [EVM_PRIMARY, EVM_SECOND] }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "listed",
      count: 2,
      wallets: [
        { address: EVM_PRIMARY, primary: false },
        { address: EVM_SECOND, primary: false },
      ],
    })
  })

  it("reports an empty claim as no wallets rather than unknown", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: [] }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "empty",
      count: 0,
      wallets: [],
      message: EMPTY_MESSAGE,
    })
  })

  it("reports an absent claim as unknown rather than no wallets", async () => {
    const output = await runWhoami(jwt({ wallet: EVM_PRIMARY }))

    expect(linkedWalletsOf(output)).toEqual({
      status: "claim_absent",
      message: CLAIM_ABSENT_MESSAGE,
    })
  })

  it("reports a claim that is not a list as unknown", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: EVM_SECOND }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "claim_unreadable",
      message: CLAIM_UNREADABLE_MESSAGE,
    })
  })

  it("reports a null claim as present and unreadable, not absent", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: null }),
    )

    expect(linkedWalletsOf(output)).toEqual({
      status: "claim_unreadable",
      message: CLAIM_UNREADABLE_MESSAGE,
    })
  })

  it("reports an unreadable access token as unknown", async () => {
    const output = await runWhoami("opaque-access-token")

    expect(linkedWalletsOf(output)).toEqual({
      status: "token_unreadable",
      message: TOKEN_UNREADABLE_MESSAGE,
    })
  })

  it("tells the four wallet answers apart", async () => {
    const listed = linkedWalletsOf(
      await runWhoami(
        jwt({ wallet: EVM_PRIMARY, linked_wallets: [EVM_PRIMARY, SOLANA] }),
      ),
    )
    const empty = linkedWalletsOf(
      await runWhoami(jwt({ wallet: EVM_PRIMARY, linked_wallets: [] })),
    )
    const absent = linkedWalletsOf(
      await runWhoami(jwt({ wallet: EVM_PRIMARY })),
    )
    const unreadable = linkedWalletsOf(await runWhoami("opaque-access-token"))

    expect([listed, empty, absent, unreadable].map(report => report)).toEqual([
      {
        status: "listed",
        count: 2,
        wallets: [
          { address: EVM_PRIMARY, primary: true },
          { address: SOLANA, primary: false },
        ],
      },
      { status: "empty", count: 0, wallets: [], message: EMPTY_MESSAGE },
      { status: "claim_absent", message: CLAIM_ABSENT_MESSAGE },
      { status: "token_unreadable", message: TOKEN_UNREADABLE_MESSAGE },
    ])
    expect(absent).not.toEqual(unreadable)
  })

  it("renders linked_wallets in table output", async () => {
    const output = await runWhoami(
      jwt({ wallet: EVM_PRIMARY, linked_wallets: [EVM_PRIMARY] }),
      [],
      "table",
    )

    expect(output).toContain(
      `linked_wallets    {"status":"listed","count":1,"wallets":[{"address":"${EVM_PRIMARY}","primary":true}]}`,
    )
  })

  it("renders linked_wallets in toon output", async () => {
    const token = jwt({ wallet: EVM_PRIMARY, linked_wallets: [EVM_PRIMARY] })

    const toon = await runWhoami(token, [], "toon")

    expect(linkedWalletsOf(toon)).toEqual({
      status: "listed",
      count: 1,
      wallets: [{ address: EVM_PRIMARY, primary: true }],
    })
  })

  it("shows the raw linked_wallets claim under --diagnostic", async () => {
    const output = await runWhoami(
      jwt({
        wallet: EVM_PRIMARY,
        linked_wallets: [EVM_PRIMARY, EVM_PRIMARY, 42],
      }),
      ["--diagnostic"],
    )
    const parsed = JSON.parse(output) as {
      linked_wallets: unknown
      diagnostic: { jwt: { linked_wallets: unknown } }
    }

    expect(parsed.diagnostic.jwt.linked_wallets).toEqual([
      EVM_PRIMARY,
      EVM_PRIMARY,
      42,
    ])
    expect(parsed.linked_wallets).toEqual({
      status: "listed",
      count: 1,
      wallets: [{ address: EVM_PRIMARY, primary: true }],
    })
  })

  it("omits the raw claim from diagnostics when the token has none", async () => {
    const output = await runWhoami(jwt({ wallet: EVM_PRIMARY }), [
      "--diagnostic",
    ])
    const parsed = JSON.parse(output) as {
      diagnostic: { jwt: Record<string, unknown> }
    }

    expect(parsed.diagnostic.jwt).toEqual({
      wallet: EVM_PRIMARY,
      opensea_scopes: [],
    })
  })
})
