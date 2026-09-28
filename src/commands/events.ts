import { Command, Option } from "commander"
import type { OpenSeaClient } from "../client.js"
import type { OutputFormat } from "../output.js"
import { outputGet } from "../output.js"
import {
  addChainOption,
  addPaginationOptions,
  addTraitsOption,
  parseIntOption,
  parseTraitsOption,
} from "../parse.js"

export function eventsCommand(
  getClient: () => OpenSeaClient,
  getFormat: () => OutputFormat,
): Command {
  const cmd = new Command("events").description("Query marketplace events")

  addPaginationOptions(
    cmd
      .command("list")
      .description("List events")
      .option(
        "--event-type <type>",
        "Event type (sale, transfer, mint, listing, offer, trait_offer, collection_offer)",
      )
      .option("--after <timestamp>", "Filter events after this Unix timestamp")
      .option(
        "--before <timestamp>",
        "Filter events before this Unix timestamp",
      )
      // GET /api/v2/events has no chain filter. The option stays declared,
      // hidden, so a --chain in either position reaches this action and is
      // refused rather than silently returning events from every chain.
      .addOption(new Option("--chain <chain>").hideHelp()),
  ).action(
    async (
      options: {
        eventType?: string
        after?: string
        before?: string
        chain?: string
        limit: string
        next?: string
      },
      command: Command,
    ) => {
      if (options.chain !== undefined) {
        command.error(
          "error: events list cannot filter by chain, because the events endpoint has no chain filter. Use 'opensea events by-account <address> --chain <chain>' or 'opensea events by-nft <chain> <contract> <token-id>' instead.",
          { code: "opensea.unsupportedChainFilter" },
        )
      }
      const client = getClient()
      await outputGet(client, getFormat(), "/api/v2/events", {
        event_type: options.eventType,
        after: options.after
          ? parseIntOption(options.after, "--after")
          : undefined,
        before: options.before
          ? parseIntOption(options.before, "--before")
          : undefined,
        limit: parseIntOption(options.limit, "--limit"),
        next: options.next,
      })
    },
  )

  addPaginationOptions(
    addChainOption(
      cmd
        .command("by-account")
        .description("Get events for an account")
        .argument("<address>", "Account address")
        .option("--event-type <type>", "Event type"),
    ),
  ).action(
    async (
      address: string,
      options: {
        eventType?: string
        chain?: string
        limit: string
        next?: string
      },
    ) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/events/accounts/${address}`,
        {
          event_type: options.eventType,
          chain: options.chain,
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
        },
      )
    },
  )

  addTraitsOption(
    addPaginationOptions(
      cmd
        .command("by-collection")
        .description("Get events for a collection")
        .argument("<slug>", "Collection slug")
        .option("--event-type <type>", "Event type"),
    ),
  ).action(
    async (
      slug: string,
      options: {
        eventType?: string
        limit: string
        next?: string
        traits?: string
      },
    ) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/events/collection/${slug}`,
        {
          event_type: options.eventType,
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
          traits: options.traits
            ? parseTraitsOption(options.traits)
            : undefined,
        },
      )
    },
  )

  addPaginationOptions(
    cmd
      .command("by-nft")
      .description("Get events for a specific NFT")
      .argument("<chain>", "Chain")
      .argument("<contract>", "Contract address")
      .argument("<token-id>", "Token ID")
      .option("--event-type <type>", "Event type"),
  ).action(
    async (
      chain: string,
      contract: string,
      tokenId: string,
      options: {
        eventType?: string
        limit: string
        next?: string
      },
    ) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/events/chain/${chain}/contract/${contract}/nfts/${tokenId}`,
        {
          event_type: options.eventType,
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
        },
      )
    },
  )

  return cmd
}
