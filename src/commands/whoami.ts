import {
  extractLinkedWallets,
  extractWalletAddress,
  tryDecodeJwtPayload,
} from "@opensea/sdk"
import { Command } from "commander"
import { loadCurrentToken } from "../auth/store.js"
import type { OutputFormat } from "../output.js"
import { formatOutput } from "../output.js"

const PROJECT_ROLES_CLAIM = "urn:zitadel:iam:org:project:roles"
const LINKED_WALLETS_CLAIM = "linked_wallets"

interface LinkedWallet {
  address: string
  primary: boolean
}

/**
 * What `whoami` can say about the wallets a token covers. The three unknown
 * statuses exist because a count of zero and "we could not read the claim"
 * are different answers to "is my portfolio total complete", and printing an
 * empty list for both is the under-reporting bug this output exists to avoid.
 */
type LinkedWalletsReport =
  | { status: "listed"; count: number; wallets: LinkedWallet[] }
  | { status: "empty"; count: 0; wallets: []; message: string }
  | { status: "claim_absent"; message: string }
  | { status: "claim_unreadable"; message: string }
  | { status: "token_unreadable"; message: string }

const TOKEN_UNREADABLE: LinkedWalletsReport = {
  status: "token_unreadable",
  message:
    "The stored access token is not a readable JWT, so the number of wallets it covers is unknown.",
}

function readScopesClaim(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string")
  }
  return []
}

function readJwtIdentity(claims: Record<string, unknown>): {
  wallet?: string
  opensea_scopes: string[]
  project_roles?: unknown
  linked_wallets?: unknown
} {
  const wallet = extractWalletAddress(claims)
  const projectRoles = claims[PROJECT_ROLES_CLAIM] ?? claims.project_roles
  const rawLinkedWallets = claims[LINKED_WALLETS_CLAIM]

  return {
    ...(wallet === undefined ? {} : { wallet }),
    opensea_scopes: readScopesClaim(claims.opensea_scopes),
    ...(projectRoles === undefined ? {} : { project_roles: projectRoles }),
    ...(rawLinkedWallets === undefined
      ? {}
      : { linked_wallets: rawLinkedWallets }),
  }
}

/**
 * EVM addresses are case insensitive and reach us in both checksum and
 * lowercase form, so fold case for those. Solana base58 is case sensitive, so
 * everything else has to match exactly rather than risk marking the wrong
 * entry as the token's own.
 */
function isSameWallet(left: string, right: string): boolean {
  if (left.startsWith("0x") && right.startsWith("0x")) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

/**
 * Describe the wallets the token resolves to.
 *
 * `extractLinkedWallets` already returns the complete set including the
 * token's own wallet, so the primary is marked in place. Appending the
 * `wallet` claim would double-count it.
 */
function reportLinkedWallets(
  accessToken: string,
  claims: Record<string, unknown> | null,
): LinkedWalletsReport {
  if (claims === null) {
    return TOKEN_UNREADABLE
  }

  // A null value is classified as unreadable rather than absent: the claim is
  // there, so saying the token carries none would be false. Either way the
  // count is reported as unknown.
  const claim = claims[LINKED_WALLETS_CLAIM]
  if (claim === undefined) {
    return {
      status: "claim_absent",
      message:
        "This access token carries no linked_wallets claim, so the number of wallets it covers is unknown.",
    }
  }
  if (!Array.isArray(claim)) {
    return {
      status: "claim_unreadable",
      message:
        "The linked_wallets claim is present but is not a list, so the number of wallets it covers is unknown.",
    }
  }

  // Read the addresses through the SDK rather than off `claim` directly, so
  // the CLI inherits its dedupe and its drop rule for non-string entries.
  const primary = extractWalletAddress(claims)
  const wallets: LinkedWallet[] = extractLinkedWallets(accessToken).map(
    address => ({
      address,
      primary: primary !== undefined && isSameWallet(address, primary),
    }),
  )

  if (wallets.length === 0) {
    return {
      status: "empty",
      count: 0,
      wallets: [],
      message:
        "The linked_wallets claim is present and lists no usable wallet addresses.",
    }
  }
  return { status: "listed", count: wallets.length, wallets }
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right)
  return left.filter(scope => !rightSet.has(scope))
}

export function whoamiCommand(getFormat: () => OutputFormat): Command {
  return new Command("whoami")
    .description(
      "Show the current authenticated wallet, its linked wallets, and scopes",
    )
    .option(
      "--diagnostic",
      "Include unverified JWT claims for troubleshooting; claims are not authorization data",
    )
    .action((options: { diagnostic?: boolean }) => {
      const token = loadCurrentToken()
      if (!token) {
        console.log(
          formatOutput(
            { status: "not_authenticated", message: "No stored token" },
            getFormat(),
          ),
        )
        return
      }

      const expired = new Date(token.expiresAt) < new Date()
      // An opaque access token is a supported input here, not an error, and
      // null is also what separates "no claim to read" from "claim read, and
      // it listed nothing".
      const claims = tryDecodeJwtPayload(token.accessToken)
      const jwt = claims === null ? undefined : readJwtIdentity(claims)
      const jwtError =
        claims === null ? "Access token is not a readable JWT" : undefined
      const linkedWallets = reportLinkedWallets(token.accessToken, claims)

      const jwtScopes = jwt?.opensea_scopes ?? []
      const broaderScopes = difference(token.scopes, token.requestedScopes)
      const diagnostic = options.diagnostic
        ? {
            unverified: true,
            jwt: jwt ?? { opensea_scopes: [] },
            scope_difference: {
              only_in_token: difference(token.scopes, jwtScopes),
              only_in_jwt: difference(jwtScopes, token.scopes),
            },
            ...(jwtError ? { jwt_error: jwtError } : {}),
          }
        : undefined
      console.log(
        formatOutput(
          {
            status: expired ? "expired" : "authenticated",
            address: token.address,
            linked_wallets: linkedWallets,
            auth_method: token.authMethod,
            scopes: token.scopes,
            requested_scopes: token.requestedScopes,
            granted_scopes: token.scopes,
            scope_source: token.scopeSource ?? "unknown",
            ...(broaderScopes.length > 0
              ? {
                  scope_warning: {
                    type: "broader_than_requested",
                    scopes: broaderScopes,
                  },
                }
              : {}),
            ...(diagnostic ? { diagnostic } : {}),
            expires_at: token.expiresAt,
            expired,
          },
          getFormat(),
        ),
      )
    })
}
