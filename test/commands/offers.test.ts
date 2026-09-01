import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { offersCommand } from "../../src/commands/offers.js"
import { type CommandTestContext, createCommandTestContext } from "../mocks.js"

function writeTempJson(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"))
  const file = join(dir, "body.json")
  writeFileSync(file, JSON.stringify(data))
  return file
}

describe("offersCommand", () => {
  let ctx: CommandTestContext

  beforeEach(() => {
    ctx = createCommandTestContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates command with correct subcommands", () => {
    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    expect(cmd.name()).toBe("offers")
    const subcommands = cmd.commands.map(c => c.name())
    expect(subcommands).toContain("all")
    expect(subcommands).toContain("collection")
    expect(subcommands).toContain("best-for-nft")
    expect(subcommands).toContain("traits")
    expect(subcommands).toContain("actions")
    expect(subcommands).toContain("fulfillment-actions")
  })

  it("all subcommand fetches all offers", async () => {
    ctx.mockClient.get.mockResolvedValue({ offers: [] })

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["all", "cool-cats", "--limit", "10"], {
      from: "user",
    })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/offers/collection/cool-cats/all",
      expect.objectContaining({ limit: 10 }),
    )
  })

  it("collection subcommand fetches collection offers", async () => {
    ctx.mockClient.get.mockResolvedValue({ offers: [] })

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["collection", "cool-cats"], { from: "user" })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/offers/collection/cool-cats",
      expect.objectContaining({ limit: 20 }),
    )
  })

  it("best-for-nft subcommand fetches best offer", async () => {
    ctx.mockClient.get.mockResolvedValue({})

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(["best-for-nft", "cool-cats", "123"], {
      from: "user",
    })

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/offers/collection/cool-cats/nfts/123/best",
    )
  })

  it("traits subcommand passes required options", async () => {
    ctx.mockClient.get.mockResolvedValue({ offers: [] })

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    await cmd.parseAsync(
      [
        "traits",
        "cool-cats",
        "--type",
        "Background",
        "--value",
        "Blue",
        "--limit",
        "5",
      ],
      { from: "user" },
    )

    expect(ctx.mockClient.get).toHaveBeenCalledWith(
      "/api/v2/offers/collection/cool-cats/traits",
      expect.objectContaining({
        type: "Background",
        value: "Blue",
        limit: 5,
      }),
    )
  })

  it("actions posts the request body without normalizing Solana values", async () => {
    ctx.mockClient.post.mockResolvedValue({ steps: [] })
    const body = {
      item: {
        chain: "solana",
        contract: "MintBase58Address",
        token_id: "TokenBase58Address",
      },
      address: "MakerBase58Address",
      quantity: 1,
      price: {
        amount: "1.5",
        currency: "So11111111111111111111111111111111111111112",
      },
    }
    const file = writeTempJson(body)

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(["actions", "--body", file], { from: "user" })
    } finally {
      rmSync(file, { force: true })
    }

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/offers/actions",
      body,
    )
  })

  it("fulfillment-actions posts the request body", async () => {
    ctx.mockClient.post.mockResolvedValue({ steps: [] })
    const body = {
      offer: {
        hash: "solana-offer-id",
        chain: "solana",
        protocol_address: "AuctionHouseBase58Address",
      },
      fulfiller: { address: "SellerBase58Address" },
      include_optional_creator_fees: false,
    }
    const file = writeTempJson(body)

    const cmd = offersCommand(ctx.getClient, ctx.getFormat)
    try {
      await cmd.parseAsync(["fulfillment-actions", "--body", file], {
        from: "user",
      })
    } finally {
      rmSync(file, { force: true })
    }

    expect(ctx.mockClient.post).toHaveBeenCalledWith(
      "/api/v2/offers/fulfillment/actions",
      body,
    )
  })
})
