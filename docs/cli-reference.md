# CLI Reference

Full command reference for all `opensea` CLI commands.

## Global Options

```
--api-key <key>     OpenSea API key (or set OPENSEA_API_KEY env var)
--chain <chain>     Default chain (default: ethereum)
--format <format>   Output format: json, table, or toon (default: json)
--base-url <url>    API base URL override (for testing against staging or proxies)
--timeout           Request timeout in milliseconds (default: 30000)
--verbose           Log request and response info to stderr
```

## Authentication

```bash
opensea whoami
```

`whoami` reads the current local auth token and shows the wallet address, the
wallets the token resolves to, requested and granted scopes, any broader-scope
warning, the scope source, and expiry. Use `opensea whoami --diagnostic` to
inspect decoded JWT claims and scope differences. Those claims are unverified,
provider-specific diagnostics only and never authorization data.

The `linked_wallets` block answers how many wallets the token covers, which is
what decides whether a portfolio total built from it is complete. It comes from
the token's `linked_wallets` claim, which already contains the token's own
wallet, so that entry is marked `primary` in place rather than added again. Its
`status` separates a real count from an unknown one:

| `status` | Meaning |
|---|---|
| `listed` | The claim listed wallets. `count` and `wallets` are the full set. |
| `empty` | The claim was read and named no wallets. `count` is 0. |
| `claim_absent` | The token carries no `linked_wallets` claim, so the count is unknown. |
| `claim_unreadable` | The claim is present but is not a list, a `null` value included, so the count is unknown. |
| `token_unreadable` | The stored access token is not a readable JWT, so the count is unknown. |

The three unknown statuses carry a `message` and no `count`, so a token minted
without the claim never looks like an account that has one wallet.

Everything `whoami` prints is read out of the token stored in
`~/.opensea/auth.json`, including the wallet address itself, and none of it is
re-verified against the server. Treat it as what your token says, not as an
authorization decision.

```json
{
  "address": "0x1111111111111111111111111111111111111111",
  "linked_wallets": {
    "status": "listed",
    "count": 2,
    "wallets": [
      { "address": "0x1111111111111111111111111111111111111111", "primary": true },
      { "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "primary": false }
    ]
  }
}
```

## Login

```bash
opensea login [--scopes <scopes>] [--client-id <id>] [--device] [--no-browser]
opensea login --private-key --scopes <scopes>
opensea login --private-key <key> --scopes <scopes>
```

`login` obtains a scoped access token and stores it in `~/.opensea/auth.json`.
By default it runs the OAuth 2.1 authorization-code flow in a browser. Use
`--device` for headless environments or `--no-browser` to print the authorization
URL. Pass `--private-key` to authenticate with SIWE instead of OAuth, which is
useful for server-side agents. Set `OPENSEA_PRIVATE_KEY` and use `--private-key`
without a value to keep the key out of shell history; a raw key can be passed as
an option value when necessary. Private-key login requires `--scopes` so the
agent's capabilities are always explicit.

Set `OPENSEA_CONFIG_DIR` to keep the auth store somewhere other than
`~/.opensea`, which is what you want for a container with a mounted volume, a CI
job that should not touch a shared home directory, or a second set of
credentials held separately.

## Collections

```bash
opensea collections get <slug>
opensea collections list [--chain <chain>] [--order-by <field>] [--creator <username>] [--include-hidden] [--limit <n>] [--next <cursor>]
opensea collections stats <slug>
opensea collections traits <slug>
```

`--order-by` values: `created_date`, `one_day_change`, `seven_day_volume`, `seven_day_change`, `num_owners`, `market_cap`

## NFTs

```bash
opensea nfts get <chain> <contract> <token-id>
opensea nfts list-by-collection <slug> [--limit <n>] [--next <cursor>]
opensea nfts list-by-contract <chain> <contract> [--limit <n>] [--next <cursor>]
opensea nfts list-by-account <chain> <address> [--limit <n>] [--next <cursor>] [--include-auto-hidden]
opensea nfts refresh <chain> <contract> <token-id>
opensea nfts contract <chain> <address>
```

`--include-auto-hidden` also returns NFTs hidden automatically because a third party minted or sent them to the account. NFTs the holder hid themselves stay hidden, and NFTs removed for policy violations are not returned.

## Listings

```bash
opensea listings all <collection> [--limit <n>] [--next <cursor>]
opensea listings best <collection> [--limit <n>] [--next <cursor>]
opensea listings best-for-nft <collection> <token-id>
opensea listings actions --body <request.json>
opensea listings fulfillment-actions --body <request.json>
```

## Offers

```bash
opensea offers all <collection> [--limit <n>] [--next <cursor>]
opensea offers collection <collection> [--limit <n>] [--next <cursor>]
opensea offers best-for-nft <collection> <token-id>
opensea offers traits <collection> --type <type> --value <value> [--limit <n>] [--next <cursor>]
opensea offers actions --body <request.json>
opensea offers fulfillment-actions --body <request.json>
```

## Orders

```bash
opensea orders cancel <chain> <protocol_address> <order_hash> [--body <request.json>]
opensea orders cancel-actions <chain> <protocol_address> <order_identifier> --body <request.json>
```

The action commands work across EVM chains and Solana. For Solana, preserve base58 address casing, use `svm_order.id` as the order identifier, and pass through the order's returned protocol address.

## Drops

```bash
opensea drops list [--type <type>] [--chains <chains>] [--limit <n>] [--next <cursor>]
opensea drops get <slug>
opensea drops mint <slug> --minter <address> [--quantity <n>]
opensea drops cross-chain-mint <slug> --payer <address> --minter <address> --payment-chain <chain> --payment-token <address> [--quantity <n>]
```

Cross-chain minting returns ordered transactions plus `receipt_request`.
Submit the transactions in order, save `receipt_request` unchanged to a JSON
file, and poll it with the transactions command until the status is terminal.

### Publishing a drop

These need a wallet token with `write:drops` (`opensea auth login`).

```bash
opensea drops publish <slug> [--send] [--wallet-provider <provider>]
opensea drops unpublish <slug> [--send] [--wallet-provider <provider>]
opensea drops upload-metadata-ipfs <slug> [--wait] [--interval <seconds>] [--wait-timeout <seconds>]
opensea drops metadata-ipfs-status <slug> <workflow-execution-id>
opensea drops create-manifest-upload <slug>
opensea drops upload-file --context <path|-> --file <path> [--index <n>]
```

`publish` and `unpublish` print a ready-to-sign transaction. With `--send`
they sign and send it with the configured EVM wallet and print the hash. The
transaction's `from` is the contract's onchain owner, and a transaction from
any other address reverts, so `--send` refuses a wallet whose address differs.

`upload-metadata-ipfs --wait` polls every `--interval` seconds (default 5)
until the status is no longer `running`, for at most `--wait-timeout` seconds
(default 600). It exits 1 on `failed`, `not_found` or a timeout.

`upload-file` performs the storage upload an upload context describes (from
`create-manifest-upload`, `create-item-media-upload` or
`create-allowlist-upload`) and prints `{"token": ...}`. It takes one context.
For the array `create-item-media-upload` returns, pass `--index <n>` or pipe
one element:

```bash
opensea drops create-manifest-upload my-drop \
  | opensea drops upload-file --context - --file manifest.csv
opensea drops create-item-media-upload my-drop --body filenames.json \
  | jq '.[0]' | opensea drops upload-file --context - --file 1.png
```

The upload URL and fields are short-lived credentials, so avoid saving the
context to a shared location. `upload-file` refuses a context whose `url` is
not HTTPS.

## Transactions

```bash
opensea transactions receipt --request <receipt-request.json>
```

## Events

```bash
opensea events list [--event-type <type>] [--after <timestamp>] [--before <timestamp>] [--chain <chain>] [--limit <n>] [--next <cursor>]
opensea events by-account <address> [--event-type <type>] [--chain <chain>] [--limit <n>] [--next <cursor>]
opensea events by-collection <slug> [--event-type <type>] [--limit <n>] [--next <cursor>]
opensea events by-nft <chain> <contract> <token-id> [--event-type <type>] [--limit <n>] [--next <cursor>]
```

Event types: `sale`, `transfer`, `mint`, `listing`, `offer`, `trait_offer`, `collection_offer` ([details](events.md))

## Search

```bash
opensea search <query> [--types <types>] [--chains <chains>] [--limit <n>]
```

`--types` values (comma-separated): `collection`, `nft`, `token`, `account`

## Tokens

```bash
opensea tokens trending [--chains <chains>] [--limit <n>] [--next <cursor>]
opensea tokens top [--chains <chains>] [--limit <n>] [--next <cursor>]
opensea tokens get <chain> <address>
opensea tokens activity-stats <chain> <address> [--windows <windows>]
```

`--windows` accepts a comma-separated list containing `5m`, `1h`, `4h`, and
`24h`. If omitted, the API returns every available materialized window.

## Swaps

```bash
opensea swaps quote --from-chain <chain> --from-address <address> --to-chain <chain> --to-address <address> --quantity <quantity> --address <address> [--slippage <slippage>] [--recipient <recipient>]
```

## Accounts

```bash
opensea accounts get <address>
```

The wallet-level agent designation used to live here as `mark-agent` and
`remove-agent`. An agent is an account now, so use the `agent` commands below.

## Agent accounts

```bash
# The owner's side: "I ask an account to become my agent".
opensea agent add <identifier>
opensea agent accept <identifier>
opensea agent remove <identifier>

# The agent's side, and either side explicitly.
opensea agent declare
opensea agent withdraw
opensea agent propose <identifier> --role AGENT|OWNER
opensea agent confirm <identifier> --role AGENT|OWNER
opensea agent revoke <identifier> --role AGENT|OWNER

opensea agent list
opensea agent profile <address_or_username>
```

Every `<identifier>` takes an OpenSea username, an ENS name, or a wallet
address. The API's `counterparty_address` field takes an address literally and
answers a username with 400 "Invalid counterparty address", so the CLI resolves
the identifier through `/api/v2/accounts/resolve` first. An address is passed
straight through with no lookup.

`add`, `accept`, and `remove` are `propose`, `confirm`, and `revoke` with
`--role OWNER` fixed, because asking an account to become your agent is the
common direction. An agent program holding a scoped token uses the three
generic verbs with `--role AGENT`.

An agent is an account, not a flag on a wallet. Ownership is a relationship
between two accounts that both sides confirm. Three things it is not:

- Not sub-accounts. Declaring yourself an agent creates no new account type.
- Not delegation. "X is my agent" grants X no ability to act for the owner. It
  is a declaration, not an authorization.
- Not verification. It is self-reported and OpenSea does not check it.

An agent can have no owner at all, and at most one confirmed owner. Either
side may withdraw or revoke at any time, which deletes the relationship. Only
confirmed relationships are public; a pending proposal is visible to the two
parties alone.

`--role` is the side *you* are on. `--role AGENT` means "I am an agent and the
counterparty owns me".

The writes need `write:wallets` and `agent list` needs `read:wallets`, so a
client driving the whole handshake must log in with both:

```bash
opensea login --private-key --scopes read:wallets,write:wallets
```

With only `write:wallets`, `agent list` fails with 403 "Insufficient
permissions". `agent profile` is a public read and needs an API key alone.

Proposing a relationship that is already awaiting you confirms it, so a client
that cannot tell who moved first can just call `propose`:

```bash
# On the agent, declaring itself and asking the owner to confirm.
opensea agent declare
opensea agent propose ryanryanryanryan --role AGENT
opensea agent list   # status PENDING_OWNER, awaiting_confirmation_from OWNER

# On the owner. Either of these lands the same confirmed relationship.
opensea agent accept imatestagent123
opensea agent add imatestagent123
```

The owner can also move first, which leaves the relationship
`PENDING_AGENT` until the agent confirms:

```bash
opensea agent add imatestagent123          # on the owner
opensea agent confirm ryanryanryanryan --role AGENT   # on the agent
```

> REST list commands support cursor-based pagination. The search command returns a flat list with no cursor. See [pagination.md](pagination.md) for details.
