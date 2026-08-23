import { Command } from "commander"
import type { OpenSeaClient } from "../client.js"
import type { OutputFormat } from "../output.js"
import { formatOutput, outputGet } from "../output.js"
import type {
  AccountResolveResponse,
  AgentAccountStatusResponse,
  AgentRelationshipMutationResponse,
  AgentRelationshipRemovalResponse,
  AgentRelationshipRole,
} from "../types/index.js"

const ROLE_DESCRIPTION =
  "Which side you are on: AGENT (this account owns me) or OWNER (I own the counterparty)"

const COUNTERPARTY_DESCRIPTION =
  "The other account: OpenSea username, ENS name, or wallet address"

const ROLES: readonly AgentRelationshipRole[] = ["AGENT", "OWNER"]

/** An EVM address needs no lookup, so it skips the resolve round-trip. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

const RELATIONSHIPS_PATH = "/api/v2/accounts/agent-relationships"
const CONFIRM_PATH = "/api/v2/accounts/agent-relationships/confirm"

/**
 * Accept `agent`/`owner` in any case so the flag is not shouty to type, but
 * send the uppercase wire value the API validates against.
 */
function parseRole(value: string): AgentRelationshipRole {
  const normalized = value.trim().toUpperCase()
  if (!ROLES.includes(normalized as AgentRelationshipRole)) {
    throw new Error(
      `Invalid value for --role: "${value}". Expected AGENT or OWNER.`,
    )
  }
  return normalized as AgentRelationshipRole
}

/**
 * Turn a username, ENS name, or address into the address the relationship
 * endpoints require.
 *
 * They take `counterparty_address` literally: a username there is rejected
 * with 400 "Invalid counterparty address", so the lookup has to happen here.
 * `/api/v2/accounts/resolve` handles all three identifier kinds, and an
 * address short-circuits so the common case costs no extra request.
 */
async function resolveCounterparty(
  client: OpenSeaClient,
  identifier: string,
): Promise<string> {
  if (EVM_ADDRESS.test(identifier)) return identifier

  const resolved = await client.get<AccountResolveResponse>(
    `/api/v2/accounts/resolve/${encodeURIComponent(identifier)}`,
  )
  const address = resolved?.address
  if (!address) {
    throw new Error(
      `Could not resolve "${identifier}" to an account address. ` +
        "Pass an OpenSea username, an ENS name, or a wallet address.",
    )
  }
  return address
}

/**
 * `agent` command group: declare an account an agent and run the two-sided
 * ownership handshake.
 *
 * An agent is an account, not a flag on a wallet, and ownership is a
 * relationship between two accounts that both confirm. It is a declaration,
 * not an authorization, and it is self-reported rather than verified.
 *
 * `add`, `accept`, and `remove` are the owner's side of the handshake, the
 * direction the product leads with: "I ask an account to become my agent".
 * Each is `propose`, `confirm`, or `revoke` with `--role OWNER` fixed. The
 * agent's side stays on those three generic verbs, which a program holding a
 * scoped token still needs.
 */
export function agentCommand(
  getClient: () => OpenSeaClient,
  getFormat: () => OutputFormat,
): Command {
  const cmd = new Command("agent").description(
    "Declare an agent account and manage agent ownership relationships " +
      "(wallet auth required; writes need write:wallets, list needs read:wallets)",
  )

  /** POST a proposal or a confirmation, resolving the counterparty first. */
  async function postRelationship(
    path: string,
    identifier: string,
    role: AgentRelationshipRole,
  ) {
    const client = getClient()
    const counterpartyAddress = await resolveCounterparty(client, identifier)
    const result = await client.post<AgentRelationshipMutationResponse>(path, {
      counterparty_address: counterpartyAddress,
      caller_role: role,
    })
    console.log(formatOutput(result, getFormat()))
  }

  async function revokeRelationship(
    identifier: string,
    role: AgentRelationshipRole,
  ) {
    const client = getClient()
    const counterpartyAddress = await resolveCounterparty(client, identifier)
    // Query parameters, not a body: fetch, OkHttp and urllib all drop
    // DELETE bodies by default and proxies may strip them.
    const result = await client.delete<AgentRelationshipRemovalResponse>(
      RELATIONSHIPS_PATH,
      undefined,
      {
        counterparty_address: counterpartyAddress,
        caller_role: role,
      },
    )
    console.log(formatOutput(result, getFormat()))
  }

  cmd
    .command("declare")
    .description(
      "Declare the authenticated account an agent (requires write:wallets). " +
        "Self-reported, not OpenSea verification. An agent nobody owns is valid.",
    )
    .action(async () => {
      const client = getClient()
      const result = await client.put<AgentAccountStatusResponse>(
        "/api/v2/accounts/agent",
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("withdraw")
    .description(
      "Withdraw the authenticated account's agent declaration " +
        "(requires write:wallets)",
    )
    .action(async () => {
      const client = getClient()
      const result = await client.delete<AgentAccountStatusResponse>(
        "/api/v2/accounts/agent",
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("add")
    .description(
      "Ask an account to become your agent (requires write:wallets). " +
        "The owner's side of `propose`. If that account already asked you, " +
        "this confirms it instead.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .action((identifier: string) =>
      postRelationship(RELATIONSHIPS_PATH, identifier, "OWNER"),
    )

  cmd
    .command("accept")
    .description(
      "Accept an account's request to be your agent (requires write:wallets). " +
        "The owner's side of `confirm`.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .action((identifier: string) =>
      postRelationship(CONFIRM_PATH, identifier, "OWNER"),
    )

  cmd
    .command("remove")
    .description(
      "Remove your agent, or withdraw a request you made " +
        "(requires write:wallets). The owner's side of `revoke`. " +
        "`removed` is false when no such relationship existed.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .action((identifier: string) => revokeRelationship(identifier, "OWNER"))

  cmd
    .command("propose")
    .description(
      "Propose an agent ownership relationship from either side " +
        "(requires write:wallets). Proposing one already awaiting you " +
        "confirms it, so if you cannot tell who moved first, just propose. " +
        "As the owner, `agent add` is this call with --role OWNER.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .requiredOption("--role <role>", ROLE_DESCRIPTION)
    .action((identifier: string, options: { role: string }) =>
      postRelationship(RELATIONSHIPS_PATH, identifier, parseRole(options.role)),
    )

  cmd
    .command("confirm")
    .description(
      "Confirm a relationship proposed to the authenticated account " +
        "(requires write:wallets). As the owner, `agent accept` is this " +
        "call with --role OWNER.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .requiredOption("--role <role>", ROLE_DESCRIPTION)
    .action((identifier: string, options: { role: string }) =>
      postRelationship(CONFIRM_PATH, identifier, parseRole(options.role)),
    )

  cmd
    .command("revoke")
    .description(
      "Withdraw a proposal or revoke a confirmed relationship " +
        "(requires write:wallets). Either side may do this at any time. " +
        "`removed` is false when no such relationship existed. " +
        "As the owner, `agent remove` is this call with --role OWNER.",
    )
    .argument("<identifier>", COUNTERPARTY_DESCRIPTION)
    .requiredOption("--role <role>", ROLE_DESCRIPTION)
    .action((identifier: string, options: { role: string }) =>
      revokeRelationship(identifier, parseRole(options.role)),
    )

  cmd
    .command("list")
    .description(
      "List the authenticated account's own relationships, including " +
        "pending proposals (requires read:wallets, not write:wallets)",
    )
    .action(async () => {
      const client = getClient()
      await outputGet(client, getFormat(), RELATIONSHIPS_PATH)
    })

  cmd
    .command("profile")
    .description(
      "Get the public agent relationships for any profile (API key only). " +
        "Shows confirmed relationships; pending proposals stay private.",
    )
    .argument("<address_or_username>", "Wallet address or OpenSea username")
    .action(async (addressOrUsername: string) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/accounts/${encodeURIComponent(addressOrUsername)}/agent-relationships`,
      )
    })

  return cmd
}
