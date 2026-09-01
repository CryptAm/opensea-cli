import { Command } from "commander"
import type { OpenSeaClient } from "../client.js"
import type { OutputFormat } from "../output.js"
import { formatOutput, outputGet } from "../output.js"
import {
  addPaginationOptions,
  parseIntOption,
  readJsonBodyOption,
} from "../parse.js"
import type {
  CreateOfferActionsRequest,
  CreateOfferActionsResponse,
  CreateOfferFulfillmentActionsRequest,
  CreateOfferFulfillmentActionsResponse,
} from "../types/index.js"

export function offersCommand(
  getClient: () => OpenSeaClient,
  getFormat: () => OutputFormat,
): Command {
  const cmd = new Command("offers").description("Query NFT offers")

  addPaginationOptions(
    cmd
      .command("all")
      .description("Get all offers for a collection")
      .argument("<collection>", "Collection slug"),
  )
    .option("--maker <address>", "Filter by order maker address")
    .action(
      async (
        collection: string,
        options: { limit: string; next?: string; maker?: string },
      ) => {
        const client = getClient()
        await outputGet(
          client,
          getFormat(),
          `/api/v2/offers/collection/${collection}/all`,
          {
            limit: parseIntOption(options.limit, "--limit"),
            next: options.next,
            maker: options.maker,
          },
        )
      },
    )

  addPaginationOptions(
    cmd
      .command("by-nft")
      .description("Get all offers for a specific NFT")
      .argument("<collection>", "Collection slug")
      .argument("<token-id>", "Token ID"),
  ).action(
    async (
      collection: string,
      tokenId: string,
      options: { limit: string; next?: string },
    ) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/offers/collection/${collection}/nfts/${tokenId}`,
        {
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
        },
      )
    },
  )

  addPaginationOptions(
    cmd
      .command("collection")
      .description("Get collection offers")
      .argument("<collection>", "Collection slug"),
  ).action(
    async (collection: string, options: { limit: string; next?: string }) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/offers/collection/${collection}`,
        {
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
        },
      )
    },
  )

  cmd
    .command("best-for-nft")
    .description("Get best offer for a specific NFT")
    .argument("<collection>", "Collection slug")
    .argument("<token-id>", "Token ID")
    .action(async (collection: string, tokenId: string) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/offers/collection/${collection}/nfts/${tokenId}/best`,
      )
    })

  addPaginationOptions(
    cmd
      .command("traits")
      .description("Get trait offers for a collection")
      .argument("<collection>", "Collection slug")
      .requiredOption("--type <type>", "Trait type (required)")
      .requiredOption("--value <value>", "Trait value (required)"),
  ).action(
    async (
      collection: string,
      options: {
        type: string
        value: string
        limit: string
        next?: string
      },
    ) => {
      const client = getClient()
      await outputGet(
        client,
        getFormat(),
        `/api/v2/offers/collection/${collection}/traits`,
        {
          type: options.type,
          value: options.value,
          limit: parseIntOption(options.limit, "--limit"),
          next: options.next,
        },
      )
    },
  )

  cmd
    .command("actions")
    .description("Get ordered actions needed to create an offer")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the CreateOfferActionsRequest body",
    )
    .action(async (options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<CreateOfferActionsRequest>(
        options.body,
        "--body",
      )
      const result = await client.post<CreateOfferActionsResponse>(
        "/api/v2/offers/actions",
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  cmd
    .command("fulfillment-actions")
    .description("Get ordered actions needed to fulfill an offer")
    .requiredOption(
      "--body <path>",
      "Path to JSON file with the offer fulfillment request body",
    )
    .action(async (options: { body: string }) => {
      const client = getClient()
      const request = readJsonBodyOption<CreateOfferFulfillmentActionsRequest>(
        options.body,
        "--body",
      )
      const result = await client.post<CreateOfferFulfillmentActionsResponse>(
        "/api/v2/offers/fulfillment/actions",
        request,
      )
      console.log(formatOutput(result, getFormat()))
    })

  return cmd
}
